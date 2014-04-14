var express = require("express");
var bodyParser = require("body-parser");
var fs = require('fs');
var winston = require('winston');
var dateFormat = require('dateformat');
var app = express();

server = require('http').createServer(app);
var io = require('socket.io').listen(server);

var sock = { emit: function(){} }; // stub

process.stdin.resume();
winston.add(winston.transports.File, { filename: 'credit.log', json: false });
var database = __dirname + '/database.json';

var users,
	savedbtimeout;

app.use('/', express.static(__dirname + '/static'));
app.use(bodyParser());

// Read database
fs.readFile(database, 'utf8', function(err, data){
	if(err){
		if (err.code == "ENOENT") {
			winston.log('warn', 'No database found. Starting from scratch.');
			users = {};
		} else {
			winston.log('error', 'Can\'t read database: ' + err);
			process.exit();
		}
	} else {
		users = JSON.parse(data);
	}
	setInterval(backupDatabase, 24 * 60 * 60 * 1000); // 1 day
});

// Write database
function saveDatabase(){
	fs.writeFile(database, JSON.stringify(users), function(err){
		if(err){
			winston.log('error', "Can't write database: " + err);
			return;
		}
	});
}

function backupDatabase(){
	var now = new Date();
	var dateformated = dateFormat(now, "yyyy-mm-dd");
	fs.writeFile(__dirname+'/backup/'+dateformated+'.json', JSON.stringify(users), function(err){
		if(err){
			winston.log('error', "Can't backup database: " + err);
			return;
		}
	});
}

app.get("/users/all", function(req, res){
	res.header("Access-Control-Allow-Origin", "*");
	res.header("Access-Control-Allow-Headers", "X-Requested-With");
	res.send(JSON.stringify(getAllUsers()));
});

app.post('/user/add', function(req, res){
	var username = req.body.username;
	addUser(username, res);
	saveDatabase();
});

app.post("/user/credit", function(req, res){
	var user = getUser(req.body.username);
	var delta = parseFloat(req.body.delta);

	if(user == undefined){
		res.send(404, "User not found");
		winston.log('error', '[userCredit] No user ' + req.body.username + ' found.')
		return;
	}
	if(isNaN(delta) || delta >= 100 || delta <= -100){
		res.send(406);
		winston.log('error', "[userCredit] delta must be a number.");
		return;
	}
	
	updateCredit(user, delta);
	
	saveUser(user);
	sock.broadcast.emit('accounts', JSON.stringify(getAllUsers()));
	sock.emit('accounts', JSON.stringify(getAllUsers()));
	sock.emit('ka-ching', JSON.stringify(getAllUsers()));
	res.send(JSON.stringify(user));
	saveDatabase();
});

io.sockets
	.on('connection', function (socket) {
		sock = socket;
		socket.emit('accounts', JSON.stringify(getAllUsers()));
	})
	.on('getAccounts', function (socket) {
		socket.emit('accounts', JSON.stringify(getAllUsers()));
	});

function getUser(username){
	return users[username];
}

function saveUser(user){
	users[user.name] = user;
}

function addUser(username, res){
	if(username == undefined || username == ""){
		res.send(406, "No username set");
		winston.log('error', '[addUser] No username set.')
		return false;
	}
	if(users[username]){
		res.send(409, "User already exists");
		winston.log('error', '[addUser] User ' + username + ' already exists.');
		return false;
	}

	users[username] = {"name": username, "credit": 0, "lastchanged": Date.now()};
	sock.broadcast.emit('accounts', JSON.stringify(getAllUsers()));
	sock.emit('accounts', JSON.stringify(getAllUsers()));
	res.send(200);
	winston.log('info', '[addUser] New user ' + username + ' created');
	return true;
}

function getAllUsers(){
	var names = Object.keys(users);
	userlist = names.map(function(name){
		return users[name];
	});

	return userlist;
}

function updateCredit(user, delta) {
	user.credit += +delta;
	user.credit = Math.round(user.credit * 100) / 100;
	user.lastchanged = Date.now();
	winston.log('info', '[userCredit] Changed credit from user ' + user.name + ' by ' + delta + '. New credit: ' + user.credit);
}

process.on('SIGTERM', function() {
	winston.log('info', 'Server shutting down. Good bye!');
	clearTimeout(savedbtimeout);
	process.exit();
});

var server = server.listen(8000, function(){
	winston.log('info', 'Server started!');
})
