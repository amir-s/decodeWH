const app = require('koa')();
const serve = require('koa-static');
const router = require('koa-router')();
const views = require('co-views');
const path = require('path');
const parse = require('koa-body');
const cnf = require('./config.js')
const shopifyAPI = require('shopify-node-api');
const Promise = require('bluebird');
const request = require('request');
const passport = require('koa-passport')
const session = require('koa-generic-session')
const ShopifyStrategy = require('passport-shopify').Strategy;


const createApi = function (config) {
	var api = new shopifyAPI(config);
	api.get = Promise.promisify(api.get, {context: api});
	api.post = Promise.promisify(api.post, {context: api});
	api.put = Promise.promisify(api.put, {context: api});
	api.patch = Promise.promisify(api.patch, {context: api});
	api.delete = Promise.promisify(api.delete, {context: api});
	return api;
}


const l = function () {
	[].slice.call(arguments).forEach(i => console.log(JSON.stringify(i, null, 4)));
	return this;
}

const render = views(__dirname + '/views', {
  map: { html: 'ejs' }
});

router.get('/', function *(next) {
	// if (!this.req.user) {
	// 	return this.redirect('/s');
	// }
	this.body = yield render('index.html')
});

router.post('/', function *(next) {
	this.body = '';
	console.log("here");
	// l(this.request.body);
	let token = this.request.body.token;
	l(token);
	let data = yield api.get(`/api/checkouts/${token}.json`);
	l(data);
	let items = [];
	if (data.checkout.line_items[0].applied_discounts.length > 0) {
		l('done');
		this.body = 'done';
		return;
	}
	data.checkout.line_items.forEach(l => {
		l.applied_discounts = [{
			amount: "10.00",
			value_type: "fixed_amount",
			value: "10.00",
			description: "blah",
			title: "blah"
		}];
		items.push(l);
	});
	l(items);
	yield api.patch(`/api/checkouts/${token}.json`, {
		checkout: {
			line_items: items
		}
	})
	this.body = 'Ok!';
});

router.get('/s', passport.authenticate('shopify', {scope: [ 'read_customers', 'write_customers' ], shop: 'decodemtla'}));

router.get('/auth/shopify/callback',
  passport.authenticate('shopify', { failureRedirect: '/s' }),
  function* (next) {
  	this.body = "hi";
    // Successful authentication, redirect home.
    // res.redirect('/')
  }
)


// const api = createApi(cnf.shopifyApi);


router.get('/api/customers.json', function*() {
	// l(this.req.user);
	const api = createApi({
		shop: 'decodemtla',
		shopify_api_key: '26aebe217b5eba85b93c6afb0d34b4b2',
		access_token: 'be7d86066f8c520e3f4ea0d6eb6c9da1',//tokens[this.req.user.id],
		verbose: false
	});
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
let tokens = {};
passport.use(
	new ShopifyStrategy({
		clientID: cnf.shopifyApi.shopify_api_key,
		clientSecret: cnf.shopifyApi.access_token,
		callbackURL: "http://7d6515f1.ngrok.io/auth/shopify/callback",
		shop: cnf.shopifyApi.shop
	}, (accessToken, refreshToken, profile, done) => {
		// l(accessToken);
		tokens[profile.id] = accessToken;
		// l(profile);
		done(null, profile);
		// User.findOrCreate({ shopifyId: profile.id }, function (err, user) {
		// return done(err, user);
	})
)
let mem = {};
passport.serializeUser(function(user, done) {
	mem[user.id] = user;
    done(null, user.id); 
});

passport.deserializeUser(function(id, done) {
    done(null, mem[id]);
});
var bodyParser = require('koa-bodyparser')
app.use(bodyParser())
// app.use(parse())
app.keys = ['secret'];
app.use(session());
app.use(passport.initialize())
app.use(passport.session())


app
	.use(router.routes())
	.use(router.allowedMethods())
	.use(serve(path.join(__dirname, 'public')));


app.listen(process.env.PORT || 80, () => console.log("Server started on", process.env.PORT || 80));


require('co')(function* () {
	// let data = yield api.get('/admin/customers.json');

	// for (let c of data.customers) {
	// 	// l(c);
	// 	l(yield api.post(`/admin/customers/${c.id}/metafields.json`, {
	// 		"metafield": {
	// 			"namespace": "decode",
	// 			"key": "credit",
	// 			"value": 25,
	// 			"value_type": "integer"
	// 		}
	// 	}));

	// }
	// l(yield f());
	// l(data)
	// let items = [];
	// data.checkout.line_items.forEach(l => {

	// 	l.applied_discounts = [{
	// 		amount: "10.00",
	// 		value_type: "fixed_amount",
	// 		value: "10.00",
	// 		description: "blah",
	// 		title: "blah"
	// 	}];

	// 	items.push(l);
	// });

	// yield api.patch('/api/checkouts/702a1d1b302feef6d1f4b9323c9e2b4f.json', {
	// 	checkout: {
	// 		line_items: items
	// 	}
	// })

	// let r = yield api.patch('/api/checkouts/702a1d1b302feef6d1f4b9323c9e2b4f.json', {
	// 	checkout: {
	// 		applied_discount: {
	// 			amount: "10.00",
	// 			value_type: "fixed_amount",
	// 			value: "10.00",
	// 			description: "blah",
	// 			title: "blah"
	// 		}
	// 	}
	// })
	// let r = api.post('/admin/webhooks.json', {
	// 	"webhook": {
	// 		"topic": "checkouts\/update",
	// 		"address": "https:\/\/c72367ae.ngrok.io\/",
	// 		"format": "json"
	// 	}
	// })
	// l(r);
}).catch(console.log)