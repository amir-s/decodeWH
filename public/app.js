!function () {

	var app = angular.module('decode', ['ui.bootstrap']);


	app.controller('MainCtrl', function ($http) {
		this.busy = true;

		$http.get('/api/customers.json').then((resp) => {
			this.busy = false;
			this.rows = resp.data;
		});

		this.showSaveEdit = function (row) {
			if (this.busy) return;
			if (row.edit){
				this.busy = true;
				$http.post('/api/customers/' + row.id + '/credit.json', {credit: row.credit}).then((resp) => {
					this.busy = false;
					row.edit = false;
				})
				return;
			}
			row.edit = true;
		}
	})
	

}();