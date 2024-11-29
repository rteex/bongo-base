// util.js
//
// Used by amedeo-api.
//


module.exports = {
  checkForATJError,
  selectElements,
  buildPaymentRequest
};

const lodash = require('lodash')
const crypto = require('crypto')


// select elements of interest from ATJ data
//
function selectElements(queryType, atjResponseAsJSON) {
  
  //console.log('selectElements')

  var temp = [{}]
  
  if (queryType === '850') {
    temp.push(retrieveElement(atjResponseAsJSON, 'historia', 'ajoneuvonTiedot'))
    temp.push(retrieveElement(atjResponseAsJSON, 'historia', 'omistajatHaltijat'))
    temp.push(retrieveElement(atjResponseAsJSON, 'historia', 'luovutusilmoitukset'))
    temp.push(retrieveElement(atjResponseAsJSON, 'historia', 'vakuutustiedot'))
    temp.push(retrieveElement(atjResponseAsJSON, 'historia', 'tunnushistoria'))
    temp.push(retrieveElement(atjResponseAsJSON, 'historia', 'poistohistoria'))
    temp.push(retrieveElement(atjResponseAsJSON, 'historia', 'katsastushistoria'))
    temp.push(retrieveElement(atjResponseAsJSON, 'historia', 'kayttohistoria'))
    temp.push(retrieveElement(atjResponseAsJSON, 'historia', 'kilometrilukemahistoria'))
  } else if (queryType === '820') {
    temp.push(retrieveElement(atjResponseAsJSON, 'suppea', 'ajoneuvonTiedot'))
  } else {
    temp.push(retrieveElement(atjResponseAsJSON, 'laaja', 'tunnus'))
    temp.push(retrieveElement(atjResponseAsJSON, 'laaja', 'ajoneuvonPerustiedot'))
    temp.push(retrieveElement(atjResponseAsJSON, 'laaja', 'erikoisehdot'))
    temp.push(retrieveElement(atjResponseAsJSON, 'laaja', 'rajoitustiedot'))
    temp.push(retrieveElement(atjResponseAsJSON, 'laaja', 'rakenne'))
    temp.push(retrieveElement(atjResponseAsJSON, 'laaja', 'moottori'))
    temp.push(retrieveElement(atjResponseAsJSON, 'laaja', 'massa'))
    temp.push(retrieveElement(atjResponseAsJSON, 'laaja', 'mitat'))
    temp.push(retrieveElement(atjResponseAsJSON, 'laaja', 'kori'))
    temp.push(retrieveElement(atjResponseAsJSON, 'laaja', 'jarrut'))
    temp.push(retrieveElement(atjResponseAsJSON, 'laaja', 'kevyenKytkenta'))
    temp.push(retrieveElement(atjResponseAsJSON, 'laaja', 'turvavarusteet'))
    temp.push(retrieveElement(atjResponseAsJSON, 'laaja', 'muutoskatsastukset'))
  }
  var all = {}
  for (i = 0; i < temp.length; i++) {
    all = Object.assign(all, temp[i])
  }
  return all;
}


// Retrieve the value of an element in JSON data based on the name of the element
//
function retrieveElement(atjResponseAsJSON, messageType, element) {
  
  // messageType can be 'laaja' or 'historia'
  var path = 'kehys.sanoma[0].ajoneuvontiedot[0].' + messageType + '[0]'
  const temp = element.split('/')
  for (let i = 0; i < temp.length; i++) {
    path +=  '.' + temp[i] + '[0]'
  }
  // console.log('Inside retrieveElement 0, path', path)
  
  const value = lodash.get(atjResponseAsJSON, path)
  
  // console.log('Inside retrieveElement 1, value', value)
  
  return value
}

  
// Check for ATJ error such as vehicle not found etc.
//
function checkForATJError(resultAsJSON) {
  if ('kehys' in resultAsJSON && 'yleinen' in resultAsJSON.kehys && 'virhe' in resultAsJSON.kehys.yleinen[0] && 'virhekoodi' in resultAsJSON.kehys.yleinen[0].virhe[0]) {
    // return resultAsJSON.kehys.yleinen[0].virhe;
    return 'NOK';
  } else {
    return 'OK';
  }
}
  


// const ACCOUNT = '375917';
// const SECRET = 'SAIPPUAKAUPPIAS';
// const PROVIDERS_URL = 'https://services.paytrail.com/payments';

/**
 * Calculate HMAC by Paytrail
 *
 * @param {string} secret Merchant shared secret
 * @param {object} params Headers or query string parameters
 * @param {object|undefined} body Request body or empty string for GET requests
 */
const calculateHmac = (secret, params, body) => {
  const hmacPayload = Object.keys(params)
    .sort()
    .map((key) => [key, params[key]].join(':'))
    .concat(body ? JSON.stringify(body) : '')
    .join('\n');

  return crypto.createHmac('sha256', secret).update(hmacPayload).digest('hex');
};


// put together a request (body and headers) to send to the provider
//
function buildPaymentRequest() {

  // Create a random number, convert it into a string
  const nonce = Math.floor(Math.random() * 900000000000000) + 100000000000000;
  const stamp = Math.floor(Math.random() * 900000000000000) + 100000000000000;

  const timestamp = new Date().toISOString();

  const checkoutHeadersGet = {
    'checkout-account': process.env.PROVIDER_ACCOUNT,
    'checkout-algorithm': 'sha256',
    'checkout-method': 'POST',
    'checkout-nonce': nonce,
    'checkout-timestamp': timestamp,
  };

  const body = {
    stamp: stamp.toString(),
    reference: '3759170',
    amount: 395,
    currency: 'EUR',
    language: 'FI',
    items: [
      {
        unitPrice: 395,
        units: 1,
        vatPercentage: 24,
        productCode: '#1234',
        deliveryDate: '2024-09-01',
      },
    ],
    customer: {
      email: 'test.customer@example.com',
    },
    redirectUrls: {
      success: 'https://zircon-41o.pages.dev/verifypayment',
      cancel: 'https://zircon-41o.pages.dev/verifypayment',
    },
  };

  // calculate HMAC
  const HMAC = calculateHmac(process.env.PROVIDER_SECRET, checkoutHeadersGet, body);
  console.log('HMAC', HMAC);
  const signatureHeader = { 'signature': HMAC };

  // Combine checkoutHeaders and signatureHeader into a single object
  const allHeaders = { ...checkoutHeadersGet, ...signatureHeader };

  return {
    body: body,
    headers: allHeaders,

  }
}