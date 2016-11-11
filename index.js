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

if (process.env.URL === undefined) {
	console.error("Set the URL first!");
	process.exit(1)
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

router.post('/checkout/update', parse(), function *(next) {
	l("checkout/update")
	this.body = '';
	let token = this.request.body.token;
	let data = yield api.get(`/api/checkouts/${token}.json`);
	let total = parseFloat(data.checkout.subtotal_price);
	let items = [];
	if (data.checkout.line_items[0].applied_discounts.length > 0) {
		return;
	}
	l(`/api/customers/${data.checkout.customer_id}/metafields.json`);
	let {metafields} = yield api.get(`/admin/customers/${data.checkout.customer_id}/metafields.json`);

	let field = metafields.filter(m => m.namespace == 'decode' && m.key == 'credit');
	let credit = 0;
	if (field.length == 1) credit = Math.min(total, field[0].value);

	data.checkout.line_items.forEach(l => {
		l.applied_discounts = [{
			amount: Math.round(credit/data.checkout.line_items.length),
			value_type: "fixed_amount",
			value: Math.round(credit/data.checkout.line_items.length),
			description: "blah",
			title: "blah"
		}];
		items.push(l);
	});
	yield api.patch(`/api/checkouts/${token}.json`, {
		checkout: {
			line_items: items
		}
	})
	this.body = 'Ok!';
});

app
	.use(router.routes())
	.use(router.allowedMethods())
	.use(serve(path.join(__dirname, 'public')));

co(function*() {
	
	let {webhooks} = yield api.get('/admin/webhooks.json');

	l(webhooks.map(wh => wh.address));

	if (false) {
		l("DELETING ALL WHS")
		for (let wh of webhooks) yield api.delete(`/admin/webhooks/${wh.id}.json`);
		webhooks = [];
	}

	if (webhooks.filter(wh => wh.address.startsWith(process.env.URL)).length > 0) {
		l("WH already exists!")
	}else {
		l("Creating WH");
		yield api.post('/admin/webhooks.json', {
			"webhook": {
				"topic": "checkouts\/update",
				"address": `${process.env.URL}/checkout/update`,
				"format": "json"
			}
		});
		l("All Set!")
	}
})

app.listen(process.env.PORT || 3000, () => console.log("Server started on", process.env.PORT || 3000));

