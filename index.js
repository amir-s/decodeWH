const app = require('koa')();
const serve = require('koa-static');
const router = require('koa-router')();
const views = require('co-views');
const path = require('path');
const parse = require('koa-body');
const cnf = require('./config.js')
const shopifyAPI = require('shopify-node-api');
const Promise = require('bluebird');
const co = require('co');
const request = require('request');
const l = require('prnt');

const STORE_CREDIT = 32254788230;

if (process.env.URL === undefined) {
	console.error("Set the URL first!");
	process.exit(1)
}

function jsonp(options) {
  options = options || {};

  let domain = options.domain || '.default.lan';
  let callbackName = options.callbackName || 'callback';
  let iframeHtmlTemplate = ['<!doctype html><html><head><meta http-equiv="Content-Type" content="text/html charset=utf-8"/><script type="text/javascript">document.domain = "' + domain + '";parent.', '(', ');</script></head><body></body></html>'];

  return function* (next) {
      var ctx = this;
      yield next;

      let startChunk, endChunk;
      let callback = ctx.query[callbackName];

      if (!callback) return;
      if (ctx.body == null) return;

      if (ctx.method === 'POST') {
        ctx.type = 'html';
        startChunk = iframeHtmlTemplate[0] + callback + iframeHtmlTemplate[1];
        endChunk = iframeHtmlTemplate[2];
      } else {
        ctx.type = 'text/javascript';
        startChunk = ';' + callback + '(';
        endChunk = ');';
      }

      // handle streams
      if (typeof ctx.body.pipe === 'function') {
        ctx.body = ctx.body.pipe(new JSONPStream({
          startChunk: startChunk,
          endChunk: endChunk
        }));
      } else {
        ctx.body = startChunk + JSON.stringify(ctx.body, null, ctx.app.jsonSpaces) + endChunk;

        // JSON parse vs eval fix. https://github.com/rack/rack-contrib/pull/37
        ctx.body = ctx.body.replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
      }
    };
};



function* getLastCheckoutId(userId) {
	let {metafields} = yield api.get(`/admin/customers/${userId}/metafields.json`);
	let field = metafields.filter(m => m.namespace == 'decode' && m.key == 'last_checkout');
	if (!field[0] || field[0].value == "---") return null;
	return field[0].value;
}

function* updateLastCheckoutId(userId, checkoutId) {
	yield api.post(`/admin/customers/${userId}/metafields.json`, {
		metafield: {
			namespace: 'decode',
			key: 'last_checkout',
			value: checkoutId,
			value_type: 'string'
		}
	});
}
function* updateStoreCredit(userId, credit) {
	yield api.post(`/admin/customers/${userId}/metafields.json`, {
		metafield: {
			namespace: 'decode',
			key: 'credit',
			value: credit,
			value_type: 'integer'
		}
	});
}
function* getStoreCredit(userId) {
	let {metafields} = yield api.get(`/admin/customers/${userId}/metafields.json`);

	let field = metafields.filter(m => m.namespace == 'decode' && m.key == 'credit');
	let credit = 0;
	if (field.length == 1) credit = field[0].value;
	return credit
	
}
function* applyStoreCredit(token) {
	let data = yield api.get(`/api/checkouts/${token}.json`);
	let total = parseFloat(data.checkout.subtotal_price);
	// l(token);
	let items = [];
	let currentStoreCredit =  data.checkout.line_items.filter(i => i.variant_id == STORE_CREDIT)[0];

	if (currentStoreCredit && currentStoreCredit.applied_discounts.length > 0) return data;
	data.checkout.line_items = data.checkout.line_items.filter(i => i.variant_id != STORE_CREDIT);
	let credit = yield getStoreCredit(data.checkout.customer_id);
	credit = Math.min(total, credit);
	// l("credit", credit)
	if (credit == 0) return data;

	data.checkout.line_items.forEach(l => {
		items.push(l);
	});

	items.push({
		variant_id: STORE_CREDIT,
		applied_discounts: [{
			amount: credit,
			value_type: "fixed_amount",
			value: credit,
			description: "blah",
			title: "blah"
		}]
	});
	
	yield api.patch(`/api/checkouts/${token}.json`, {
		checkout: {
			line_items: items
		}
	});
	return data;
}
let ignore = {};

function* undoStoreCredit(token) {
	l("%% undoing", token);
	let data = yield api.get(`/api/checkouts/${token}.json`);

	let items = data.checkout.line_items.filter(l => l.variant_id != STORE_CREDIT);
	ignore[token] = ignore[token] || 0;
	ignore[token]++;
	yield api.patch(`/api/checkouts/${token}.json`, {
		checkout: {
			line_items: items
		}
	})
	return data;
}
const createApi = function (config) {
	var api = new shopifyAPI(config);
	api.get = Promise.promisify(api.get, {context: api});
	api.post = Promise.promisify(api.post, {context: api});
	api.put = Promise.promisify(api.put, {context: api});
	api.patch = Promise.promisify(api.patch, {context: api});
	api.delete = Promise.promisify(api.delete, {context: api});
	return api;
}

const api = createApi(cnf.shopifyApi);

const render = views(__dirname + '/views', {
  map: { html: 'ejs' }
});

router.get('/', function*() {
	this.body = yield render('index.html');
});

router.post('/orders/paid', parse(), function *(next) {
	l("### orders/paid");
	this.body = '';
	let data = this.request.body;
	let discount = Math.max(0, parseFloat(data.total_discounts));
	l("t", discount);
	let {metafields} = yield api.get(`/admin/customers/${data.customer.id}/metafields.json`);
	let field = metafields.filter(m => m.namespace == 'decode' && m.key == 'credit');
	let credit = 0;
	if (field.length == 1) credit = field[0].value;

	let newCredit = Math.max(0, credit-discount);
	l("new credit", newCredit);
	yield updateStoreCredit(data.customer.id, newCredit);

	let lastCheckout = yield getLastCheckoutId(data.customer.id);
	l(data.checkout_token, lastCheckout);
	if (data.checkout_token == lastCheckout) {
		yield updateLastCheckoutId(data.customer.id, "---");
	}
	l("updated");
});
router.post('/checkout/update', parse(), function *(next) {
	l("### checkout/update");
	this.body = '';
	let currentToken = this.request.body.token;
	l("current", currentToken);
	if (ignore[currentToken]) {
		l("Ignoring!", currentToken);
		ignore[currentToken]--;
		// delete ignore[currentToken];
		return;
	}
	let prevToken = yield getLastCheckoutId(this.request.body.customer.id);

	if (prevToken && prevToken != currentToken) {
		yield undoStoreCredit(prevToken);
	}
	let data = yield applyStoreCredit(currentToken);

	// if this is not a paid order
	if (data.checkout.order == null) {
		yield updateLastCheckoutId(data.checkout.customer_id, currentToken);
	}

	this.body = 'Ok!';
});

router.get('/api/customers.json', function*() {
	let {customers} = yield api.get('/admin/customers.json');
	let out = [];
	for (let c of customers) {
		let {metafields} = yield api.get(`/admin/customers/${c.id}/metafields.json`);
		let field = metafields.filter(m => m.namespace == 'decode' && m.key == 'credit');
		let credit = 0;
		if (field.length == 1) credit = field[0].value;
		out.push({
			id: c.id,
			first_name: c.first_name,
			last_name: c.last_name,
			email: c.email,
			credit: credit
		})
	}
	this.body = out;
});

router.get('/jsonp/customers.json', jsonp(), function*() {
	l("getting the list");
	let {customers} = yield api.get('/admin/customers.json');
	let out = [];
	for (let c of customers) {
		let {metafields} = yield api.get(`/admin/customers/${c.id}/metafields.json`);
		let field = metafields.filter(m => m.namespace == 'decode' && m.key == 'credit');
		let credit = 0;
		if (field.length == 1) credit = field[0].value;
		out.push({
			id: c.id,
			first_name: c.first_name,
			last_name: c.last_name,
			email: c.email,
			credit: credit
		})
	}
	this.body = out;
});

router.get('/api/checkouts.json', function*() {
	let {customers} = yield api.get('/admin/customers.json');
	let out = [];
	for (let c of customers) {
		out.push({
			email: c.email,
			token: yield getLastCheckoutId(c.id)
		})
	}
	this.body = out;
});

router.post('/api/customers/:id/credit.json', parse(), function*() {
	l("getting the list")
	if (!this.params.id) return;
	let credit = this.request.body.credit || 0;
	l("Credit", credit);
	yield updateStoreCredit(this.params.id, this.request.body.credit)
	this.body = {ok: true};
})

router.get('/jsonp/customers/:id/:credit', jsonp(), function*() {
	l("updating", this.params)
	if (!this.params.id || !this.params.credit) return;
	yield updateStoreCredit(this.params.id, this.params.credit)
	this.body = {ok: true};
})

app
	.use(router.routes())
	.use(router.allowedMethods())
	.use(serve(path.join(__dirname, 'public')));

co(function*() {
	
	let {webhooks} = yield api.get('/admin/webhooks.json');

	l(webhooks.map(wh => wh.address));

	if (!false) {
		l("DELETING ALL WHS")
		for (let wh of webhooks) yield api.delete(`/admin/webhooks/${wh.id}.json`);
		webhooks = [];
	}

	if (webhooks.filter(wh => wh.address.startsWith(process.env.URL)).length > 0) {
		l("WH already exists!")
	}else {
		l("Creating WH");
		l(yield api.post('/admin/webhooks.json', {
			"webhook": {
				"topic": "checkouts/update",
				"address": `${process.env.URL}/checkout/update`,
				"format": "json"
			}
		}));
		l(yield api.post('/admin/webhooks.json', {
			"webhook": {
				"topic": "orders/paid",
				"address": `${process.env.URL}/orders/paid`,
				"format": "json"
			}
		}));

		l("All Set!")
	}
	// yield undoStoreCredit("d7dced3c60a3bcfd996974929b5a9a2e")
	// yield undoStoreCredit("1fc664affc9431f83f7d5ea80c73f4c2")
	// yield updateStoreCredit(5004906694, 100)

}).catch(l);

app.listen(process.env.PORT || 3000, () => console.log("Server started on", process.env.PORT || 3000));

