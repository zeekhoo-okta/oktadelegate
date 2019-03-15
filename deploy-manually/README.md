# Manual Deployment
Follow these steps to deploy on AWS using Elastic Beanstalk. For simplicity, we use AWS API Gateway to serve the endpoints over https **(Okta Inline Hooks require https)** but you can of course use other methods to do this.

### Setup a redis cache
[Launch a Redis ElastiCache cluster](https://docs.aws.amazon.com/AmazonElastiCache/latest/red-ug/GettingStarted.CreateCluster.html):
* Use the default Redis `Port 6379`
* Tip: Choose a `t1.micro` node type or get ready to be surprised by your AWS bill.
* **Make sure to deploy in the same VPC as the Elastic Beanstalk application**

### Elastic Beanstalk
A Git archive of this project  `oktadelegate.zip` is included. Deploy this as a *single instance* (good enough for testing purposes. Read more about [Environment Types](https://docs.aws.amazon.com/elasticbeanstalk/latest/dg/using-features-managing-env-types.html)) Elastic Beanstalk deployment:
* From Elastic Beanstalk click [Create New Application]. Provide a name, e.g. oktadelegate and click [Create]
* Click [Actions] > [Create Environment]
* Choose "Web server environment" and click [Select]
* Provide environment name, e.g. oktadelegate-demo
* Choose Platform = Node.js
* Upload `oktadelegate.zip` as the Application code
* Click [Create environment]

#### Elastic Beanstalk Configuration
After the environment is done building, add the following Environment Properties:
* Configuration > Software > click [Modify], and add the following:

| NAME | VALUE (EXAMPLE) | DESCRIPTION |
| ---- | --------------- | ----------- |
|<sub>BASE_URL</sub>|`https://dev-666666.oktapreview.com`|<sub>The url of your Okta org</sub>|
|<sub>ISSUER</sub>|`https://dev-666666.oktapreview.com/oauth2/default`|<sub>The issuer string of your Authorization Server configured in Okta</sub>|
|<sub>CLIENT_ID</sub>|`0oa4oy6xZjhJ7vWgR1t9`|<sub>The client_id of the Application configured in Okta</sub>|
|<sub>ASSERT_AUD</sub>|`api://oktadelegate`|<sub>The Audience claim string you configured for your Authorization Server</sub>|
|<sub>ASSERT_SCOPE</sub>|`groupadmin`|<sub>A custom scope that the Actor is authorized to use. *More about this below in the "Okta Setup" section*</sub>|
|<sub>SSWS</sub>|`00PEBvZk9M0F3ozG8EWXZnd_0xFQP__zXR`|<sub>Generate an API Key in Okta for calling the OKta Management APIs</sub>|
|<sub>ELASTICACHE_CONNECT_STRING</sub>|`oktadelegate-redis.wtdkro.0001.usw2.cache.amazonaws.com`|<sub>The value of the Redis "Primary Endpoint"...exclude the port number. You can find this in the ElastiCache console</sub>|
|<sub>CLIENT_USERNAME</sub>|`serviceaccountusername`|<sub>The /delegate/hook/callback endpoint is protected with Basic auth. *More about this below in the "Okta Setup" section*. Provide a username</sub>|
|<sub>CLIENT_PASSWORD</sub>|`password123`|<sub>The /delegate/hook/callback endpoint is protected with Basic auth. *More about this below in the "Okta Setup" section*. Provide a password</sub>|
|<sub>TIME_LIMIT</sub>|`600`|<sub>The time allowed (in seconds) for a Proxy Login session, after which the app reverts back to the original user context</sub>|

#### Configure Security Groups
Update the ElastiCache's (Redis deployed in previous step) Security Group Inbound rules to allow the Elastic Beanstalk app to access `port 6379`

#### Exposing https
Okta Inline Hooks requires https. A quick and easy way to serve the Elastic Beanstalk app through https is by setting up a [proxy integration](https://docs.aws.amazon.com/apigateway/latest/developerguide/api-gateway-set-up-simple-proxy.html) using AWS API Gateway.

* Create a new API
    - Click [+ Create API]
    - Select REST, New API. 
    - Provide API name, and Select Endpoint Type = Regional.
* Create a "HTTP Proxy" resource 
    * From the Resources tab, choose Actions > Create Resource
        * Resource Path = `{proxy+}`
        * Enable API Gateway CORS = `Y`
        * Click [Create Resource]
* Configure the resource Integration Request
    * Integration type = `HTTP Proxy`
    * Use HTTP Proxy integration = `Y`
    * Endpoint URL = The public url of the Elastic Beanstalk Environment app deployed in previous steps + "/"  + "{proxy}" e.g. `http://oktadelegate-dev-1.us-west-2.elasticbeanstalk.com/{proxy}`
    * Content Handling = `Passthrough`
* Deploy the API (you'll see the Public https url after you've successfully deployed)

### Okta Setup
Setup [Token Inline Hook](https://developer.okta.com/use_cases/inline_hooks/token_hook/token_hook) so that the access_tokens issued by Okta is patched with a callback we deployed in previous steps (i.e. the `/delegate/hook/callback` endpoint)
* [Activate the Inline Hook](https://developer.okta.com/use_cases/inline_hooks/token_hook/token_hook#enabling-a-token-inline-hook) (Register the `/delegate/hook/callback` endpoint).
    - One of the rules defined in the Custom Authorization Server must be configured to trigger invocation of this hook:
        + Authorization Servers > Access Policies > Select the policy that will trigger the hook > Select or Add Rule > "Use this inline hook" = (select the activated hook)