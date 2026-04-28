const express = require('express');
const path = require('path');
const app = express();
const PORT = process.env.PORT || 3000;

// Serve the static chat UI
app.use(express.static(path.join(__dirname, 'public')));

// In production, this would be the API proxy layer:
// app.use('/v1', require('./routes/api'));

app.listen(PORT, () => {
  console.log(`cocapn.ai chat UI running at http://localhost:${PORT}`);
});
