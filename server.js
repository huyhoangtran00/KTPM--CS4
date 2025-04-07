const express = require('express');
const bodyParser = require('body-parser');
const path = require('path');
const Persistent = require('./lib/db');
const lib = require('./utils');
const cors = require('cors');

const app = express();
const port = 8080;

app.use(bodyParser.json());
app.use(cors());
app.post('/add', async (req, res) => {
    try {
        const { key, value } = req.body;
        console.log(req.body);
        console.log(`key: ${key}, value: ${value}`);
        await Persistent.write(key, value);
        res.send("Insert a new record successfully!");
    } catch (err) {
        res.send(err.toString());
    }
});

app.get('/get/:id', async (req, res) => {
    try {
        const id = req.params.id;
        const value = await Persistent.view(id);
        res.status(200).send(value);
    } catch (err) {
        res.send(err)
    }
});


app.get('/viewer/:id', (req, res) => {
    const id = req.params.id;
    res.sendFile(path.join(__dirname, "viewer.html"));
});

app.listen(port, () => {
    console.log(`Server is running on port ${port}`);
});

