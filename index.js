const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

// express - routes
const express = require('express');
const app = express();

console.log("hi, i'm bongo/base");
console.log("SECRET1", process.env.SECRET1);


app.get('/api/test', async (req, res) => {
  // send the response
  res.status(200).send({name: 'base'})
})


// Error handling middleware - TODO! Is this actually needed?
//
app.use((error, req, res, next) => {
  console.error(error);
  res.status(500).send({ error: 'Something went very much wrong' });
});


// Listening...
//
app.listen(process.env.PORT, () => {
  console.log(`Server (base) running on port ${process.env.PORT}`)
})