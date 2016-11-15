!function () {

	var app = angular.module('decode', ['ui.bootstrap']);


	app.controller('MainCtrl', function ($http) {
		$http.get('/api/customers.json').then((resp) => {
			this.rows = resp.data;
		});
	})
	

}();