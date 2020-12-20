const fs = require('fs');
const readline = require('readline');
const {google} = require('googleapis');
const request = require('request');
const requestPromise = require('request-promise');
const httpsProxyAgent = require('https-proxy-agent');
const schedule = require('node-schedule');

// If modifying these scopes, delete token.json.
const SCOPES = ['https://www.googleapis.com/auth/contacts.readonly'];
// The file token.json stores the user's access and refresh tokens, and is
// created automatically when the authorization flow completes for the first
// time.
const TOKEN_PATH = 'token.json';

let LIST_ID;
let API_KEY;
let BASIC_AUTH_KEY;

// Run initApp() 4x each day
let rule = new schedule.RecurrenceRule();
rule.hour = new schedule.Range(0, 23, 4);
// FOR TESTING
// rule.minute = new schedule.Range(0, 59, 1);
initApp();
schedule.scheduleJob(rule, initApp)

// Get all credentials then run authorize() function
function initApp(){

  let filesToRead = ['credentials.json', 'campaign-monitor-key.json'];
  let promisesArray = []
  for (let i = 0; i < filesToRead.length; i++) {
    promisesArray.push(
      new Promise((resolve, reject) => {
        fs.readFile(filesToRead[i], (err, data) => {
          if(err){ reject(err) }
          else{ resolve(JSON.parse(data)) }
        });
      })
    );
  }

  Promise.all(promisesArray)
  .then(credentials => {

    // Authorize a client with credentials, then call the Google Tasks API.
    authorize(credentials[0], getRecentConnections);
    LIST_ID = credentials[1].list_id;
    API_KEY = credentials[1].api_key;
    BASIC_AUTH_KEY = Buffer.from(API_KEY + ":x").toString("base64");

  })
  .catch(err => console.log(err));

}

/**
 * Create an OAuth2 client with the given credentials, and then execute the
 * given callback function.
 * @param {Object} credentials The authorization client credentials.
 * @param {function} callback The callback to call with the authorized client.
 */
function authorize(credentials, callback) {
  //const {client_secret, client_id, redirect_uris} = credentials.installed;
  const oAuth2Client = new google.auth.OAuth2(
      credentials.web.client_id, credentials.web.client_secret, credentials.web.redirect_uris[0]);

  // Check if we have previously stored a token.
  fs.readFile(TOKEN_PATH, (err, token) => {
    if (err) return getNewToken(oAuth2Client, callback);
    oAuth2Client.setCredentials(JSON.parse(token));
    callback(oAuth2Client);
  });
}

/**
 * Get and store new token after prompting for user authorization, and then
 * execute the given callback with the authorized OAuth2 client.
 * @param {google.auth.OAuth2} oAuth2Client The OAuth2 client to get token for.
 * @param {getEventsCallback} callback The callback for the authorized client.
 */
function getNewToken(oAuth2Client, callback) {
  const authUrl = oAuth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: SCOPES,
  });
  console.log('Authorize this app by visiting this url:', authUrl);
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  rl.question('Enter the code from that page here: ', (code) => {
    rl.close();
    oAuth2Client.getToken(code, (err, token) => {
      if (err) return console.error('Error retrieving access token', err);
      oAuth2Client.setCredentials(token);
      // Store the token to disk for later program executions
      fs.writeFile(TOKEN_PATH, JSON.stringify(token), (err) => {
        if (err) return console.error(err);
        console.log('Token stored to', TOKEN_PATH);
      });
      callback(oAuth2Client);
    });
  });
}

/**
 * List connections by most recent.
 * For those less than 24 hrs old, add them to subscription list.
 *
 * @param {google.auth.OAuth2} auth An authorized OAuth2 client.
 */
function getRecentConnections(auth) {

  console.log(LIST_ID);
  const service = google.people({version: 'v1', auth});

  service.people.connections.list({
    resourceName: 'people/me',
    pageSize: 10,
    personFields: 'names,emailAddresses,events,metadata',
    sortOrder:"LAST_MODIFIED_DESCENDING"
  }, (err, res) => {
    if (err) return console.error('The API returned an error: ' + err);

    const connections = res.data.connections;
    if (connections) {
      connections.forEach((person) => {
        if (person.names && person.names.length > 0) {
          let sourcesArray = person.metadata.sources;
          sourcesArray.forEach((source) => {
            if(source.type == 'CONTACT' && lessThan1DayAgo(source.updateTime)) {
              let displayName = person.names[0].displayName;
              let emailAddress = person.emailAddresses[0].value;
              console.log(displayName);
              console.log(emailAddress);
              console.log(source.updateTime);

              
              checkSubscriptionStatus(emailAddress, displayName)
                .then(res => {
                  console.log("then after checkSubscriptionStatus");
                  console.log(res);
                  if(res.Code == "203") {
                    console.log("wooo success");
                    addSubscriber(res.Data);
                  };
                })
                .catch(err => console.log(err));
                

            }

          });

        } else {
          console.log('No display name found for connection.');
        }

      });

    } else {
      console.log('No connections found.');
    }
  });
}

function lessThan1DayAgo(updateTime){
  let d = new Date();
  let updateDate = new Date(updateTime);
  let diffInSeconds = (d.getTime() - updateDate.getTime())/1000;
  console.log(diffInSeconds);
  if(diffInSeconds < 60*60*24){
    return true;
  }
  else {
    return false;
  }
}

function checkSubscriptionStatus(emailAddress, displayName){

  return new Promise((resolve, reject) => {

    let options = {
      url: "https://api.createsend.com/api/v3.2/subscribers/" + LIST_ID + ".json?email=" + emailAddress + "&includetrackingpreference=true",
      headers: {
        "Host": "api.createsend.com",
        "Content-Type": "application/json",
        "Accept": "application/json",
        "Authorization": "Basic " + BASIC_AUTH_KEY
      }
    };

    request(options, (error, response, body) => {

      if(error) {
        reject("THIS WAS ERROR");
      }
      else {
        let dataObject = JSON.parse(body);
        dataObject.Data = {};
        dataObject.Data.Email = emailAddress;
        dataObject.Data.Name = displayName;
        dataObject.StatusCode = response.statusCode;
        resolve(dataObject);
      }

    });

  });

}
function addSubscriber(dataObject){

  let requestBody = {
    "EmailAddress": dataObject.Email,
    "Name": dataObject.Name,
    "CustomFields": [{
        "Key": "Source",
        "Value": "Google Contacts"
    }],
    "Resubscribe": true,
    "RestartSubscriptionBasedAutoresponders": true,
    "ConsentToTrack":"Yes"
  };
  console.log(requestBody);

  let options = {
    url: "https://api.createsend.com/api/v3.2/subscribers/" + LIST_ID + ".json",
    method: "POST",
    headers: {
      "Host": "api.createsend.com",
      "content-type": "application/json",
      "Accept": "application/json",
      "Authorization": "Basic " + BASIC_AUTH_KEY
    },
    body: requestBody,
    json: true
  };

  request(options, (error, response, body) => {
    if(error) { console.log(error); }
    else {
      console.log(response.statusCode);
      if(response.statusCode == "201") {
        console.log("wooh, added this email successfully", body);
      }
      else {
        console.log("error in adding email: ", body);
      }
    }
  });

}


