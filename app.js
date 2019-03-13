const express = require("express");
const OktaJwtVerifier = require('@okta/jwt-verifier');
const bodyParser = require('body-parser');
const redis = require("redis");
const request = require('request');

/**
 * Environment variables
 */
const base_url = process.env.BASE_URL
const issuer = process.env.ISSUER
const client_id = process.env.CLIENT_ID
const assert_aud = process.env.ASSERT_AUD
const assert_scope = process.env.ASSERT_SCOPE
const SSWS = process.env.SSWS
const client_username = process.env.CLIENT_USERNAME
const client_password = process.env.CLIENT_PASSWORD


const redis_client = redis.createClient(6379, process.env.ELASTICACHE_CONNECT_STRING);
redis_client.on("error", function (err) {
    console.log("Error " + err);
});

const app = express();
app.use(bodyParser.json());


/*
 * Do a Basic Auth check on the callback
 * This is middleware that asserts valid credentials are passed into the Callback Request
 */
function callbackAuthRequired(req, res, next) {
	const authHeader = req.headers.authorization || '';
	const match = authHeader.match(/Basic (.+)/);

	if (!match) {
		return res.status(401).end();
	}

	const credentials = match[1];
	var auth = Buffer.from(client_username + ':' + client_password).toString('base64');

	if (credentials === auth) {
		next();		
	} else {
		res.status(401).send('Callback Request Not authorized');
	}
}

app.post('/delegate/hook/callback', callbackAuthRequired, (req, res) => {
	var sessionid = req.body.data.context.session.id;
	var default_profile = req.body.data.context.user.profile;

	function redis_get_promise(key) {
		return new Promise((resolve, reject) => {
			redis_client.get(key, (error, result) => {
				if (error) throw error;
				var value = JSON.parse(result);
				resolve(value);
			})
		})
	}

	async function callback(key) {
		var profile = await redis_get_promise(key);
		var debug_statement = {};
		if (profile) {
			debug_statement = default_profile.firstName + ' ' + default_profile.lastName + ' is performing actions for ' + profile.firstName + ' ' + profile.lastName;
		} else {
			profile = default_profile;
		}
		var callback_response = {
			"commands": [{
				"type": "com.okta.access.patch",
				"value": [{
					"op": "add",
					"path": "/claims/sessionid",
					"value": sessionid
				},
				{
					"op": "add",
					"path": "/claims/user_context",
					"value": profile
				}]
			}],
			"debugContext": {
				"userDelegationEventLoggng": debug_statement
			}
		}
		res.send(callback_response);
	}

	callback(sessionid);
})


const oktaJwtVerifier = new OktaJwtVerifier({
  issuer: issuer,
  clientId: client_id,
  assertClaims: {
    aud: assert_aud,
  },
});

/**
 * A simple middleware that asserts valid access tokens and sends 401 responses
 * if the token is not present or fails validation.  If the token is valid its
 * contents are attached to req.jwt
 */
function authenticationRequired(req, res, next) {
	const authHeader = req.headers.authorization || '';
	const match = authHeader.match(/Bearer (.+)/);

	if (!match) {
		return res.status(401).end();
	}

	const accessToken = match[1];

	return oktaJwtVerifier.verifyAccessToken(accessToken)
	.then((jwt) => {
		req.jwt = jwt;

		var scopes = req.jwt.claims.scp; 
		if (!scopes.includes(assert_scope)) {
			res.status(401).send('Not authorized to delegate');
		}
		var sessionid = req.jwt.claims.sessionid;
		if (!sessionid) {
			res.status(401).send('Invalid session');	
		}

		next();
	})
	.catch((err) => {
		res.status(401).send(err.message);
	});
}


app.post('/delegate/init', authenticationRequired, (req, res) => {
	var sessionid = req.jwt.claims.sessionid;
	var delegation_target = req.body.delegation_target;

	//The Bearer token to this api call contains a "uid" claim. This is the Okta userId
	var admin_id = req.jwt.claims.uid;

	var headers = {
		'Authorization': 'SSWS ' + SSWS
	}


	function groups_promise(target_id) {
		return new Promise((resolve, reject) => {
			var groups = [];
			var users_groups_api = base_url + '/api/v1/users/' + target_id + '/groups';	
			request({url: users_groups_api, headers: headers}, (error, response, body) => {
				if (!error && response.statusCode == 200) {
					groups = JSON.parse(body);
				}
				resolve(groups);
			});
		}) 
	}

	function get_roleid_promise(admin_id) {
		return new Promise((resolve, reject) => {
			var role_id = null;
			var admins_roles_api = base_url + '/api/v1/users/' + admin_id + '/roles';
			request({url: admins_roles_api, headers: headers}, (error, response, body) => {
				if (!error && response.statusCode == 200) {
					var info = JSON.parse(body);
					for (var i=0; i<info.length; i++) {
						if (info[i].type === 'USER_ADMIN') {
							role_id = info[i].id;
							break;
						}
					}
				}
				resolve(role_id);
			})
		})
	}

	function user_admin_groups_promise(admin_id, role_id) {
		var groups = [];
		return new Promise((resolve, reject) => {
			var admins_roles_targets_groups_api = base_url + '/api/v1/users/' + admin_id + '/roles/' + role_id + '/targets/groups';
			request({url: admins_roles_targets_groups_api, headers: headers}, (error, response, body) => {
				if (!error && response.statusCode == 200) {
					groups = JSON.parse(body);
				}
				resolve(groups);
			})
		})
	}

	function user_profile_promise(username) {
		var users = null;
		return new Promise((resolve, reject) => {
			var users_api = base_url + '/api/v1/users?filter=profile.login%20eq%20%22' + username + '%22';
			request({url: users_api, headers: headers}, (error, response, body) => {
				if (!error && response.statusCode == 200) {
					var result = JSON.parse(body);
					if (result.length === 1) {
						/**
						 * A unique result should return from the filter. 
						 * Otherwise return null because we don't know who to delegate
						 */
						users = result[0];
					}
				}
				resolve(users);
			})  
		})
	}

	async function send_delegate_init_to_redis() {
		var status = 'NOT FOUND';
		var profile = null;
		var role_id = await get_roleid_promise(admin_id);
		//Must be a user admin (group admin)
		if (role_id) {
			//List of groups the group admin can manage
			var admins_groups = await user_admin_groups_promise(admin_id, role_id);

			//Get the target's user id and profile info
			var delegation_target_obj = await user_profile_promise(delegation_target);
			if (delegation_target_obj) {
				//List of groups the target is member of
				var users_groups = await groups_promise(delegation_target_obj.id);
				var admins_groups_ids = [];
				for(var i=0; i<admins_groups.length; i++){
					admins_groups_ids.push(admins_groups[i].id);
				}
				for(var i=0; i<users_groups.length; i++){
					if (admins_groups_ids.includes(users_groups[i].id)) {
						status = 'SUCCESS';
						profile = delegation_target_obj.profile;
						break;
					}
				}
			}
		}

		// Auto expire the cache after 10 seconds
		redis_client.set(sessionid, JSON.stringify(profile), 'EX', '10', redis.print);

		res.send({
			"status": status
		});
	}

	send_delegate_init_to_redis();
});


const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`App listening on port ${port}!`)
});
