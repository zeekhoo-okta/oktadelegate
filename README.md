# Introduction
A "Proxy Login" function is the application's ability to provide a privileged actor the ability to *"impersonate"* another subject. The general requirement is to generate tokens – having identity and claims – on behalf of a subject without the subject's interaction.

#### Terminology
To avoid confusion, we use the following terminology:

| Term   | Description                                                        |
|--------|--------------------------------------------------------------------|
| Actor  | The privileged user that is authorized to proxy login another user |
| Target | The user who is subject to the proxy login event                   |


Okta provides a set of out-of-the-box tools and functionality; allowing customers to properly implement – with the goals of security and audit-ability in mind – various proxy login use-cases.

## Sample
#### High Level Architecture
The general idea is to allow the application to gain user context (attributes and permissions) of the Target so that it can perform actions on the Target's behalf, but is always aware that the actual user is the Actor. Okta's [Group Admin Role](https://help.okta.com/en/prev/okta_help_CSH.htm#Security_Administrators) functionality provides the data relationship model between Actor and Target. And [Okta's Token Inline Hooks functionality](https://developer.okta.com/use_cases/inline_hooks/token_hook/token_hook) provide the mechanism that allows additional context to be injected into OAuth tokens issued by Okta.

This sample **Express** project provides 2 endpoints that you can add to your Application backend to implement the proxy login flow:
* **POST /delegate/init** - Authorizes the Actor to Proxy a specific Target. Reads Target information and caches it in session for the callback
* **POST /delegate/hook/callback** - Updates the access_token with the Target information cached during the /delegate/init call

For illustration, the following diagram shows Okta acting as the Authorization Server to an application using Authorization Code flow. The 2 service endpoints appear as a standalone service `oktadelegate`, separate from the Application backend.
* Instructions on how to deploy this project as a standalone is provided below
* Running the service standalone is an option (also good for POCs). Alternatively, expose the 2 endpoints using your own methodology. E.g. refactor the code into the App's server/backend, run them as Lambdas, etc.

#### Code Flow
![Code flow](images/oktadelegate-codeflow.png)

# Deployment
Deployment instructions are provided below:

### Prerequisite
* An application already integrated to use Okta with OpenID Connect or OAuth 2.0

| Method                            | Description                     |
|-----------------------------------|---------------------------------|
| [Cloud Formation](/deploy-script) | TODO |
| [Manual](/deploy-manually)        | Use the AWS Management Console  |

Once deployed:
* Provide a way for your App to call `POST /delegate/init`  to authorize the Actor to proxy their Target. 
* If the call is successful, then the App should refresh the access_token. 
* And if successful, the access_token will present a `user_context` claim with the Target's info. 

