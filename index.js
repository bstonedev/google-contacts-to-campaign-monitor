const fs = require('fs');
const readline = require('readline');
const {google} = require('googleapis');
const request = require('request');


// Campaign Monitor add subscriber endpoint
fs.readFile('campaign-monitor-keys.json', (err, keys) => {
  let keysJson = JSON.parse(keys);
  const LIST_ID = keysJson.list_id;
  const API_KEY = keysJson.api_key;
});

// If modifying these scopes, delete token.json.
const SCOPES = ['https://www.googleapis.com/auth/contacts.readonly'];
// The file token.json stores the user's access and refresh tokens, and is
// created automatically when the authorization flow completes for the first
// time.
const TOKEN_PATH = 'token.json';

// Load client secrets from a local file.
fs.readFile('credentials.json', (err, content) => {
  if (err) return console.log('Error loading client secret file:', err);
  // Authorize a client with credentials, then call the Google Tasks API.
  authorize(JSON.parse(content), getRecentConnections);
});

// maybe do a promise all for both fs.readfile instances

/**
 * Create an OAuth2 client with the given credentials, and then execute the
 * given callback function.
 * @param {Object} credentials The authorization client credentials.
 * @param {function} callback The callback to call with the authorized client.
 */
function authorize(credentials, callback) {
  //const {client_secret, client_id, redirect_uris} = credentials.installed;
  const oAuth2Client = new google.auth.OAuth2(
      credentials.web.client_id, credentials.web.client_secret, "https://stonedigital.com.au");

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
                  console.log(res);
                  if(res.status == "203") {
                    addSubscriber(res.data);
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

  let options = {
    url: "https://api.createsend.com/api/v3.2/subscribers/" + LIST_ID + ".json?email=" + emailAddress + "&includetrackingpreference=true",
    auth: {
      bearer: API_KEY
    }
  };

  new Promise((resolve, reject) => {

    request(options, (error, response, body) => {

      if(error) {
        reject(error);
      }
      if(response == "203") {
        console.log("Subscriber Not In List");

        let dataObject = {
          status: "203",
          body: body,
          data: {
            email: emailAddress,
            name: displayName
          }
        };

        resolve(dataObject);
      }
      else {
        resolve(response, body);
      }

    });

  });

}
function addSubscriber(dataObject){

  let requestBody = {
    "EmailAddress": dataObject.email,
    "Name": dataObject.name,
    "CustomFields": [
      {
        "Key": "Source",
        "Value": "Google Contacts"
      }
    ],
    "Resubscribe": true,
    "RestartSubscriptionBasedAutoresponders": true,
    "ConsentToTrack":"Yes"
  };

  let options = {
    url: "https://api.createsend.com/api/v3.2/subscribers/" + LIST_ID + ".json",
    method: "POST",
    auth: {
      bearer: API_KEY
    }
    body: requestBody
  };

  request(options, (error, response, body) => {
    if(error) { reject(error); }
    if(response == "201") {
      console.log("success!")
    }
    else {
      console.log(response, body);
    }
  });

}


