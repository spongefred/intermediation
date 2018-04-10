var mysql = require('../server/node_modules/mysql')
// Let’s make node/socketio listen on port 3000
var io = require('../server/node_modules/socket.io').listen(3000)
// Define our db creds
var db = mysql.createConnection({
    host: 'localhost',
    user: 'root',
	password : '',
    database: 'postgresql-parallel-44685',
    multipleStatements: true
})
 
// Log any errors connected to the db
db.connect(function(err){
    if (err) console.log(err);
})
 
 /**************************************************************************************/
// Define/initialize setting variables
var crate = 25; // conversion rate in game (Points / crate = euros)
var crate2 = 50; // conversion rate in social preferences (Points / crate2 = euros)
var sufee = 5; // show up fee (in euros)
var k=4; // linking cost (in points), TO BE UPDATED DEPENDING ON TREATMENT
var v=10; // value produced by each pair (in points), TO BE UPDATED DEPENDING ON TREATMENT
var nb_rounds=3; // number of rounds to be played in all groups
var min_duration = 60; // minimum number of periods per round / minimum duration of round (in s)
var max_duration = 90; // maximum number of periods per round / maximum duration of round (in s)
var session = 1; // id of session
var start_id =	1; // initialize id of first subject
var refresh_time = 5; // time (in s) between network updates
var init_endowment=0; // initial endowment (in points)
var period_time=30; // time (in s) of each period within a round
var grps = [4,3]; // specify the size of each group: [size of group 1, size of group 2, ..., size of group n]
/***************************************************************************************/


/****************************************************************************************/
// Initialize database and environment variables
var end_round=0;
var players_ready = []; // list of players who are ready to move to the next round
var direct_net=[]; // directed network
var res_net=[]; // resulting network (payoff effective)
var direct_net_prev=[]; // directed network from previous period
var time_start;
var round = 1;
var period = 1;
var clients=0;
var time_upd_start=-1;
var time_upd_end=0;

db.query('TRUNCATE usrcontrol;TRUNCATE result;TRUNCATE data;TRUNCATE matching;TRUNCATE social'); // empty all tables from DB

var duration = [];
for (var x = 0; x < nb_rounds; x++) {
	duration.push(rand(min_duration,max_duration)); // duration of each round in seconds
}
list_durations=duration.toString();

var session_size=0;
for (var x=0;x<grps.length;x++) {
	session_size=session_size+grps[x];
}

var ids=sequence(session_size);
shuffle(ids);

var x=0;
var matching=[];
for (var i=0;i<grps.length;i++){
	direct_net.push([]);
	res_net.push([]);
	direct_net_prev.push([]);
	var numbers=sequence(grps[i]);
	shuffle(numbers);
	matching.push({grp:i+1,round:1,order:numbers});
	db.query('INSERT INTO matching (grp, round, matching) VALUES (?, 1, ?)', [i+1, numbers.toString()]);
	var match_id=1;
	for (var j=0;j<grps[i];j++){
		// initialize empty networks for each group
		direct_net[i].push([]);
		res_net[i].push([]);
		direct_net_prev[i].push([]);
		var sliders=sequence(5);
		shuffle(sliders);
		var order_slider=sliders.toString(); // order of dictator games to measure social preferences in part 2
		var new_id=ids[x]+start_id-1;
		var scroll=rand(1,10); // default position of scroll bar for right part of the screen
		db.query('INSERT INTO usrcontrol (id, session, grp, match_id, session_size, grp_size, v, k, ready, started, nb_rounds, duration, min_duration, max_duration, crate, crate_sp, sufee, scroll, order_slider, refresh_time, endowment, round, period_time) VALUES (?,?,?,?,?,?,?,?,0,0,?,?,?,?,?,?,?,?,?,?,?,1,?)', [new_id, session, i+1, match_id, session_size, grps[i], v, k, nb_rounds, list_durations, min_duration, max_duration, crate, crate2, sufee, scroll, order_slider, refresh_time, init_endowment,period_time]);
		x++;
		match_id++;
	}
}

var val=[];
db.query('SELECT * FROM usrcontrol')
	.on('result', function(res){
		val.push(res);
	})
	.on('end', function(){
		if (val.length==session_size)
			console.log("System ready. Waiting for participants...");
		else
			console.log("Database not ready. Try again...");
	})
	
/*************************************************************************************************/

io.sockets.on('connection', function(socket){	
	
	clients++;
	if (clients==session_size){
		console.log("All "+clients+" participants connected. Ready to start...");
	}
	
	// initialize dynamic tables in DB (at the beginning of experiment)
    socket.on('init', function(data){
		if (players_ready.indexOf(data.id_subj)<0)
			players_ready.push(data.id_subj);
		db.query('INSERT INTO result (id_subj, round, period, session, id_grp, grp, duration, links) VALUES (?,1,1,?,?,?,?,"[]")', [data.id_subj,session,data.id_grp,data.grp,duration[round-1]]);
//		db.query('INSERT INTO live (id_subj,id_grp, session, grp, round, period, links) VALUES (?,?,?,?,1,1,"[]")', [data.id_subj,data.id_grp, session,data.grp]);
		if (players_ready.length==session_size){
			players_ready=[];
			var now=new Date();
			time_start=now.getTime();
			db.query('UPDATE result SET time_start=?, time=? WHERE round=?', [time_start,time_start,round]);
			console.log(now+": start round "+round);
			io.sockets.emit('init');
		}
    })
	
	// read payoff effective choices from DB (at the end of round)
	socket.on('end_round', function(data){
		end_round++;
		if (end_round>=session_size){
			if (end_round==session_size)
				players_ready=[];
			var val=[];
			io.sockets.emit('end_round', {duration:duration[round-1], net:res_net});
			var now=new Date();
			console.log(now+": end round "+round);
		}
    })

	// at beginning of a new round, save payoffs and initialize new round
	socket.on('new_round', function(data){
		if (players_ready.indexOf(data.id_subj)<0)
			players_ready.push(data.id_subj);
		db.query('UPDATE result SET payoff=? WHERE id_grp=? AND grp=? AND round=?', [data.payoffs,data.id_grp,data.grp,round]);
		direct_net[data.grp-1][data.id_grp-1]=[]; // reinitialize network
		direct_net_prev[data.grp-1][data.id_grp-1]=[]; // reinitialize previous network
		var new_round=round+1;
		var ids_grp,new_id_grp;
		if (new_round<=nb_rounds){
			if (players_ready.length==1){
				for (var i=0;i<grps.length;i++){
					ids_grp = sequence(grps[i]);
					shuffle(ids_grp);
					matching.push({grp:i+1,round:new_round,order:ids_grp.slice()});
					console.log(matching);
					db.query('INSERT INTO matching (grp, round, matching) VALUES (?, ?, ?)',[i+1,new_round,ids_grp.toString()]);
					if (i+1==data.grp){
						new_id_grp=ids_grp[data.match_id-1];
						db.query('INSERT INTO result (id_subj, round, period, session, id_grp, grp, duration, links) VALUES (?,?,1,?,?,?,?,"[]")', [data.id_subj,new_round,session,new_id_grp,data.grp,duration[round-1]]);
					}
				}
			} else {
				ids_grp = matching.find(match => match.grp==data.grp && match.round==new_round);
				new_id_grp=ids_grp.order[data.match_id-1];				
				db.query('INSERT INTO result (id_subj, round, period, session, id_grp, grp, duration, links) VALUES (?,?,1,?,?,?,?,"[]")', [data.id_subj,new_round,session,new_id_grp,data.grp,duration[round-1]]);
				if (players_ready.length==session_size){
					round++;
					period=1;
					players_ready=[];
					for (var i=0;i<res_net.length;i++){ // reinitialize results
						for (var j=0;j<res_net[i].length;j++){
							res_net[i][j]=[];
						}
					}
					var now=new Date();
					time_start=now.getTime();
					db.query('UPDATE result SET time_start=?, time=? WHERE round=?', [time_start,time_start,round]);
					console.log(now+": start round "+round);
					end_round=0;
					io.sockets.emit('new_round');
				}
			}
//			db.query('UPDATE live SET id_grp=?, session=?, grp=?, round=?, period=1, links="[]" WHERE id_subj = ?',[new_id_grp,session,data.grp,new_round,data.id_subj]);
		}
		db.query('UPDATE usrcontrol SET round=? WHERE id=?', [new_round,data.id_subj]);
    })
	
	// start new period
	socket.on('new_period', function(data){
		var now=new Date();
		var current_time=now.getTime();
		if (players_ready.indexOf(data.id_subj)<0)
			players_ready.push(data.id_subj);
		var new_period=period+1;
		db.query('UPDATE result SET period=? WHERE id_grp = ? AND round = ? AND grp=?',[new_period,data.id_grp,round,data.grp]);
		var links_str=direct_net[data.grp-1][data.id_grp-1].toString();
		links_str="["+links_str+"]";
		if (data.val){
			var time=current_time-time_start;
			db.query('INSERT INTO data (id_subj, id_grp, session, grp, round,period, time, links) VALUES (?,?,?,?,?,?,?,?)',[data.id_subj,data.id_grp,session,data.grp,round,period,time,links_str]); // store submit data
		}
		if (players_ready.length==session_size){			
			direct_net_prev=duplicate_array(direct_net);
			period++;
			players_ready=[];
			db.query('UPDATE result SET time_start=?, time=? WHERE round=?', [current_time,current_time,round]);
			time_start=current_time;
			if (period<=max_duration) // go to next period
				io.sockets.emit('new_period',{time:current_time, net:direct_net});
			else { // end of round
				var val=[];
				io.sockets.emit('end_round', {duration:duration[round-1], net:res_net});
				var now=new Date();
				console.log(now+": end round "+round);
			}
		}
    })
	
	// update a link
	socket.on('link', function(data){
		var val;
		while (time_upd_start>time_upd_end); // wait for ongoing reading of net
		time_upd_start=new Date().getTime();
		var current_time=time_upd_start;
		var time=current_time-time_start;
		if (direct_net[data.grp-1][data.id_grp-1].indexOf(data.dest)<0)
			direct_net[data.grp-1][data.id_grp-1].push(data.dest);
		else
			direct_net[data.grp-1][data.id_grp-1]=direct_net[data.grp-1][data.id_grp-1].diff([data.dest]);
		time_upd_end=new Date().getTime();
		var links_str=direct_net[data.grp-1][data.id_grp-1].toString();
		links_str="["+links_str+"]";
//		db.query('UPDATE live SET id_grp=?, session=?, grp=?, round=?, period=?, time=?, links=? WHERE id_subj = ?',[data.id_grp,session,data.grp,round,period,time,links_str,data.id_subj]);
		if (time<=duration[round-1]){ // continuous time only
//		if (period<=duration[round-1]){ // discrete time only
			res_net[data.grp-1][data.id_grp-1]=direct_net[data.grp-1][data.id_grp-1].slice();
			db.query('UPDATE result SET time=?, links=? WHERE id_grp = ? AND round = ? AND grp=?',[current_time,links_str,data.id_grp,round,data.grp]);
		}
		db.query('INSERT INTO data (id_subj, id_grp, session, grp, round,period, time, links) VALUES (?,?,?,?,?,?,?,?)',[data.id_subj,data.id_grp,session,data.grp,round,period,time,links_str]); // store choice data
		io.sockets.emit('link', {src:data.id_grp, grp:data.grp, dest:direct_net[data.grp-1][data.id_grp-1]}) // continuous time only
		console.log("t = "+Math.floor(time)+"s: player "+data.id_grp+" from group "+data.grp+" updates a link with player "+data.dest);
    })
	
	// send entire network to client after screen refresh
	socket.on('refresh_net', function(data){
		while (time_upd_start>time_upd_end); // wait for ongoing updates to end
		time_upd_start=new Date().getTime();
//		var tmp_net=duplicate_array(direct_net_prev[data.grp-1]); // discrete time only
//		tmp_net[data.id_grp-1]=direct_net[data.grp-1][data.id_grp-1].slice(); // discrete time only
//		io.sockets.connected[socket.id].emit("refresh_net", tmp_net); // discrete time only
		io.sockets.connected[socket.id].emit("refresh_net", direct_net[data.grp-1]); // continuous time only
		time_upd_end=new Date().getTime();
		console.log("Refresh by player "+data.id_grp);
    })
	
	// synchronize time with clients
	socket.on('request_time', function(){
		var current_time=new Date().getTime();
		io.sockets.connected[socket.id].emit("request_time", current_time-time_start);
    })
})

Array.prototype.diff = function(a) { 
	return this.filter(function(i) {return a.indexOf(i) < 0;});
}

function rand(min,max){
	return Math.floor((Math.random() * (max-min)) + min)
}

function sequence(n){
	return Array.from(new Array(n),(val,index)=>index+1)
}

function shuffle (array) {
  var i = 0, j = 0, temp = null
  for (i = array.length - 1; i > 0; i -= 1) {
    j = Math.floor(Math.random() * (i + 1))
    temp = array[i]
    array[i] = array[j]
    array[j] = temp
  }
}

function duplicate_array(arr){
    var i, copy;
    if( Array.isArray( arr ) ) {
        copy = arr.slice( 0 );
        for( i = 0; i < copy.length; i++ ) {
            copy[ i ] = duplicate_array( copy[ i ] );
        }
        return copy;
    } else {
        return arr;
    }
}
