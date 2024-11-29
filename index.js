/*
 * index.js for bongo-base
 *
 * Receives requests from UI and calls Traficom API.
 * Based on altair-api.
 * 
 */

// versioning
const bongoBaseVersion = '0.1.1'; // 2024-11-29

console.log("*** bongo-base version", bongoBaseVersion, "started ***");


// express - routes
const express = require('express');
const rateLimit = require('express-rate-limit');
const app = express();

// cors
const cors = require('cors');
app.use(cors());

// dotenv
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

// rate limiter
const overallLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour window
  max: process.env.REQUEST_RATE, // Max requests per hour overall
  handler: (req, res) => {
    const timeStamp = new Date();
    console.log(timeStamp, 'Rate limit exceeded');
    // Send a JSON response for rate limit exceeded
    res.status(200).json({
      error: 'Too Many Requests',
      message: 'You have exceeded the maximum number of requests allowed. Please try again later.',
      code: 429,
    });
  },
});

// // apply the overall rate limiters to all requests
app.use(overallLimiter);

// axios - http fetch
const axios = require('axios');

// fixie for fixed ips
const url = require('url');
const fixieUrl = url.parse(process.env.FIXIE_URL);
const fixieAuth = fixieUrl.auth.split(':');

// supercharge
const requestIp = require('@supercharge/request-ip')

// mongo
const mongoose = require('mongoose');

const logSchema = new mongoose.Schema({
  date: Date,
  status: String,
  note: String,
  queryType: String,
  regType: String,
  ip: String,
  duration: Number,
  rte: String,
  version: String,
  promoToken: String
})
const Log = mongoose.model('Log', logSchema);

const paymentSchema = new mongoose.Schema({
  date: Date,
  transactionId: String,
  reference: String,
  href: String,
  regNumber: String,
  vin: String,
  regType: String,
  used: Date
})
const Payment = mongoose.model('Payment', paymentSchema)

const tokenSchema = new mongoose.Schema({
  created: Date,
  updated: Date,
  expires: Date,
  token: String,
  legend: String,
  credits: Number
})
const Token = mongoose.model('Token', tokenSchema)

mongoose.set('strictQuery', false);

async function connectToMongo() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log("Connected to MongoDB");
  } catch (error) {
    console.error("Error connecting to MongoDB:", error);
  }
}
connectToMongo();

// file system
const fs = require('fs')

// ISO 8859-1 conversion
const iconv = require('iconv-lite')

// XML to JSON parser
// const { DOMParser, XMLSerializer } = require('xmldom')
const xml2js = require('xml2js')
const xml2jsParser = new xml2js.Parser()

// imports from util
const { checkForATJError, selectElements, buildPaymentRequest } = require('./util');

// global constants
const trafiTimeoutLimit = 15000 // milliseconds - consider storing in .env
const historyQuery = '850'
const extendedQuery = '840'
const limitedQuery = '820'


/***************************** R o u t e s  b e g i n  h e r e ************************************************/


// r e g  lookup
//
// Run two queries (historia & laaja), that fetch data from Traficom API. 
// Modify the responses (xml to json), combine them and send to caller.
//
app.get('/api/reg', async (req, res) => {

  const reqRegNumber = req.query.regNumber;
  const reqVin = req.query.vin;
  const reqRegType = req.query.regType;
  const promoToken = req.query.promoToken;
  const payToken = req.query.payToken;
  const ipAddress = req.ip
  let regNumber = '';
  let vin = '';
  let regType = '';
  const queryType = 'combo'
  let payTokenOk = false;
  let promoTokenOk = false;
  let queryStatus = 'undefined';

  // console.log('--------------------------------------------------------------');
  // console.log(new Date(), 'client calls new _reg_, reqRegNumber', reqRegNumber, 'payToken', payToken);
  // console.log(new Date(), 'client is coming from IP: ', requestIp.getClientIp(req));

  // use either the requested reg number or the one retrieved from db (payment)
  if (payToken) {
    const responseObject = await checkPayToken(payToken);
    payTokenOk = responseObject.success;
    regNumber = responseObject.regNumber;
    vin = responseObject.vin;
    regType = responseObject.regType;
  }
  if ((reqRegNumber || reqVin) && promoToken) {
    // find promo token in database and check its validity
    promoTokenOk = await checkPromoToken(promoToken);
    regNumber = reqRegNumber;
    vin = reqVin;
    regType = reqRegType;
  }

  const timeStamp = new Date();
  console.log(timeStamp, '_reg_, promoTokenOk', promoTokenOk, 'payTokenOk', payTokenOk, 'regNumber', regNumber);

  if (promoTokenOk || payTokenOk) {

    // console.log(new Date(), '_reg_, promoTokenOk or payToken is good');

    // record start time
    const startTime = process.hrtime();
    let trafiHistoryResponse = 'empty';
    let trafiExtendedResponse = 'empty';

    // run history query
    try {
      ({ response: trafiHistoryResponse, queryStatus } = await fetchData(regNumber, vin, historyQuery, regType));
      // const data = await fetchData(regNumber, vin, historyQuery, regType);
      // res.status(200).json({
      //   success: true,
      //   data
      // });      
      // console.log(new Date(), '_reg_, queryStatus', queryStatus);
    } catch (error) {
      console.error('Data fetch (history) error:', error);
      res.status(200).json({
        success: false,
        message: 'An error occurred while processing your request.',
        code: 'SERVER_ERROR'
      });
      return;
    }

    // run extended query
    try {
      ({ response: trafiExtendedResponse, queryStatus } = await fetchData(regNumber, vin, extendedQuery, regType));
      // const data = await fetchData(regNumber, vin, historyQuery, regType);
      // res.status(200).json({
      //   success: true,
      //   data
      // }); 
      // console.log(new Date(), '_reg_, queryStatus', queryStatus);
    } catch (error) {
      console.error('Data fetch (extended) error:', error);
      res.status(200).json({
        success: false,
        message: 'An error occurred while processing your request.',
        code: 'SERVER_ERROR'
      });
      return;
    }

    // combine the two trafi meassages and send the response
    res.status(200).send(Object.assign(trafiHistoryResponse, trafiExtendedResponse))

    // write to log
    const elapsed = process.hrtime(startTime)
    const milliseconds = elapsed[0] * 1000 + elapsed[1] / 1000000
    writeToDbLog(queryStatus, regNumber + vin, queryType, regType, ipAddress, milliseconds, process.env.RTE, bongoBaseVersion, promoToken)
    // console.log(new Date(), '_reg_, calling _reg_ completed', regNumber, queryStatus, milliseconds.toFixed(0), new Date())
  } else { // payToken or promoToken not OK
    res.status(200).json({
      success: false,
      message: 'Access denied. Please contact support for assistance.',
      code: 'UNAUTHORIZED_ACCESS'
    });
    console.warn('Unauthorized access attempt logged');
    return;
  }
})


// p a y m e n t / : i d 
//
// Find payment in db
//
app.get('/api/paymentfind/:id', async (req, res) => {
  const id = req.params.id;
  const queryType = 'findpayment';
  let queryStatus = 'undefined';

  console.log('client calls _findpayment_', new Date());
  console.log('client is coming from IP: ', requestIp.getClientIp(req));

  // record start time
  const startTime = process.hrtime();

  console.log('client calls find payment in db', id);

  try {
    // find payment with transactionId
    const payment = await Payment.findOne({ transactionId: id }).exec();

    if (payment) { // payment found
      res.json(payment);
      queryStatus = 'OK';
    } else {
      res.status(404).end();
      queryStatus = 'NOF'; // payment not found
    }
  } catch (error) { // Mongo error or other
    console.error('Error connecting to MongoDB:', error);
    res.status(500).send('Internal Server Error');
    queryStatus = 'NOK (Mongo)';
  } finally {
    // Write to log regardless of success or failure
    const elapsed = process.hrtime(startTime);
    const milliseconds = elapsed[0] * 1000 + elapsed[1] / 1000000;
    writeToDbLog(queryStatus, id, queryType, null, req.ip, milliseconds, process.env.RTE, bongoBaseVersion);
    console.log('calling _findpayment_ completed', id, queryStatus, new Date());
  }
});


/***************************** R o u t e s  e n d ************************************************/


// Find token in database. If it's found update it and return true.
//
async function checkPromoToken(targetToken) {

  // console.log(new Date(), 'checkPromoToken begins');
  // const now = new Date();

  try {
    const token = await Token.findOne({ token: targetToken }).exec();
    
    console.log(new Date(), 'checkPromoToken, token', token);

    if (token && token.expires > new Date() && token.credits > 0) {
      // Update the token
      token.credits = token.credits - 1;
      token.updated = new Date();

      // Save the updated token
      await token.save();
      // console.log(new Date(), 'checkPromoToken, token updated successfully');
      return true;
    } else {
      console.log(new Date(), 'checkPromoToken, token not found');
      return false;
    }
  } catch (error) {
    console.error(new Date(), 'checkPromoToken, error connecting to MongoDB:', error);
    return false;
  }
}


// Find payToken in database. 
//
async function checkPayToken(payToken) {

  //const now = new Date();
  // console.log(new Date(), 'checkPayToken begins');

  try {
    const payment = await Payment.findOne({ transactionId: payToken }).exec();
    // console.log(new Date(), 'checkPayToken, payToken found', payToken, 'used', payment.used);
    if (payment) {
      if (payment.used === null || payment.used === undefined) {
        // Update payment
        payment.used = new Date();
        // Save the updated payment
        await payment.save();
        // console.log(new Date(), 'checkPayToken, payment updated successfully');
        return { success: true, regNumber: payment.regNumber };
      } else {
        // console.log(new Date(), 'checkPayToken, payment already used');
        return { success: false };
      };
    } else {
      console.log(new Date(), 'checkPayToken, payment not found');
      return { success: false };
    }
  } catch (error) {
    console.error(new Date(), 'checkPayToken, error connecting to MongoDB:', error);
    return { success: false };
  }
}


// UTF to ISO conversion
//
function utf8ToIso8859(string) {
  const utf8Chars = string.split('');
  let iso8859Chars = '';

  for (let i = 0; i < utf8Chars.length; i++) {
    const utf8CharCode = utf8Chars[i].charCodeAt(0);

    // Tarkista, onko merkki yksi niistä, jotka pitää muuntaa
    switch (utf8CharCode) {
      case 196: // Ä
        iso8859Chars += String.fromCharCode(196); // Ä vastaa samaa merkkiä ISO-8859-1:ssä
        break;
      case 228: // ä
        iso8859Chars += String.fromCharCode(228); // ä vastaa samaa merkkiä ISO-8859-1:ssä
        break;
      case 246: // ö
        iso8859Chars += String.fromCharCode(246); // ö vastaa samaa merkkiä ISO-8859-1:ssä
        break;
      default:
        // Muut merkit kopioidaan sellaisenaan
        iso8859Chars += utf8Chars[i];
    }
  }

  return iso8859Chars;
}


// c h a r T o B y t e s
//
function charToBytes(char) {
  return char.charCodeAt(0); // Get the numerical code point in Latin-1
}


// Fetch data from Traficom API, convert to JSON, filter elements
//
async function fetchData(regNumber, vin, queryType, regType) {

  var selectedData = {} // a placeholder for the elements of interest
  let queryStatus = 'NOK';

  // build query string
  if (typeof vin === 'undefined') {
    vin = ''
  }
  if (typeof queryType === 'undefined') {
    queryType = extendedQuery
  }
  if (typeof regType === 'undefined') {
    regType = '1'
  }

  const queryString = await buildQuery(regNumber, vin, queryType, regType)

  const binQueryString = new Uint8Array(queryString.length);

  for (let i = 0; i < queryString.length; i++) {
    binQueryString[i] = charToBytes(queryString[i]);
  }

  // this code is run if query exceeds time limit
  const timeoutPromise = new Promise((resolve, reject) => {
    setTimeout(() => {
      reject(new Error('API request timed out after ' + trafiTimeoutLimit / 1000 + ' seconds'));
    }, trafiTimeoutLimit);
  });

  // the actual API call
  const hostUrl = process.env.MAIN_HOST_URL

  const apiPromise = axios.post(hostUrl, binQueryString, {
    proxy: {
      protocol: 'http',
      host: fixieUrl.hostname,
      port: fixieUrl.port,
      auth: { username: fixieAuth[0], password: fixieAuth[1] }
    },
    headers: { 'Content-Type': 'text/xml; iso-8859-1' }, responseType: 'arraybuffer'
    // headers: { 'Content-Type': 'application/octet-stream' }, responseType: 'arraybuffer'
  })

  try {
    // race the two promises against each other. TODO: check who won
    const trafiResponse = await Promise.race([apiPromise, timeoutPromise]);

    const temp = iconv.decode(trafiResponse.data, 'iso-8859-1')

    // write the raw xml to console
    // console.log('**************************************************************')
    // console.log('**************************************************************')
    // console.log(temp)
    // console.log('**************************************************************')
    // console.log('**************************************************************')

    // xml -> json
    xml2jsParser.parseString(temp, (err, resultAsJSON) => {
      if (err) {
        // TODO! logging
        console.error(err);
        res.status(500).send('An error occurred while parsing the XML');
      } else {
        // check for ATJ error such as vehicle not found etc.
        queryStatus = checkForATJError(resultAsJSON)
        console.log(new Date(), 'queryType', queryType, 'queryStatus', queryStatus, 'regNumber', regNumber);

        if (queryStatus === 'OK') {
          // TODO! if error log and quit
          // pick only essential elements, ignore the rest
          selectedData = selectElements(queryType, resultAsJSON)
        } else {
          selectedData = resultAsJSON
        }
      }
    });

    // return selectedElements;
    return { response: selectedData, queryStatus: queryStatus }

  } catch (error) {
    //throw new Error(`API request failed: ${error.message}`);
    if (error.response) {
      // The request was made and the server responded with a status code
      // that falls out of the range of 2xx
      throw new Error(`API request failed with status ${error.response.status}: ${error.response.data}`);
    } else if (error.request) {
      // The request was made but no response was received
      throw new Error('API request made, but no response received');
    } else {
      // Something happened in setting up the request that triggered an Error
      throw new Error(`API request setup error: ${error.message}`);
    }
  }
}


// read template, replace placeholders with arguments and environment variables
//
async function buildQuery(regNumber, vin, queryType, regType) {

  // Read router template
  let queryTemplate = '';

  if (vin.length > 0) { // it's VIN - read VIN template
    try {
      queryTemplate = fs.readFileSync('./queryTemplateVIN.txt', 'utf8');
    } catch (err) {
      console.log('File not found ./queryTemplateVIN.txt');
    }
  } else { // it's reg number - read regular reg number template
    try {
      queryTemplate = fs.readFileSync('./queryTemplate.txt', 'utf8');
    } catch (err) {
      console.log('File not found ./queryTemplate.txt');
    }
  }

  // Replace tags with function arguments and keywords from .env
  let xmlQuery = queryTemplate.replace(/#SECRET1#/g, process.env.SECRET1);
  xmlQuery = xmlQuery.replace(/#SECRET2#/g, process.env.SECRET2);
  xmlQuery = xmlQuery.replace(/#SECRET3#/g, process.env.SECRET3);
  xmlQuery = xmlQuery.replace(/#SECRET4#/g, process.env.SECRET4);
  xmlQuery = xmlQuery.replace(/#SECRET5#/g, process.env.SECRET5);
  xmlQuery = xmlQuery.replace(/#REGNUMBER#/g, regNumber);
  xmlQuery = xmlQuery.replace(/#VIN#/g, vin);
  xmlQuery = xmlQuery.replace(/#QUERYTYPE#/g, queryType);
  xmlQuery = xmlQuery.replace(/#REGTYPE#/g, regType);
  // console.log('buildQuery, xmlQuery', xmlQuery);
  return xmlQuery;
}


// write to database log 
//
async function writeToDbLog(queryStatus, regNumber, queryType, regType, ipAddress, duration, rte, apiVersion, promoToken) {
  try {
    // a log entry
    const log = new Log({
      date: new Date(),
      status: queryStatus,
      note: regNumber,
      queryType: queryType,
      regType: regType,
      ip: ipAddress,
      duration: duration,
      rte: rte,
      version: apiVersion,
      promoToken: promoToken
    });

    // save the entry
    await log.save();
    // console.log('Log entry saved successfully');
  } catch (error) {
    console.error('Error saving log entry:', error);
    // Handle the error appropriately
    throw error; // Optionally rethrow the error if needed
  }
}


// Error handling middleware - TODO! Is this actually needed?
//
app.use((error, req, res, next) => {
  console.error(error);
  res.status(500).send({ error: 'Something went very much wrong' });
});


// Listening...
//
app.listen(process.env.PORT, () => {
  console.log(`Server running on port ${process.env.PORT}`)
})

