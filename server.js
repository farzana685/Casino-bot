const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http, { cors: { origin: "*" } });
const path = require('path');

let houseBenefitPool = 0;
let activeDatabase = {};
let engineRunning = false;

app.use(express.static(path.join(__dirname)));
app.get('/', (req, res) => { res.sendFile(path.join(__dirname, 'index.html')); });

const channelMatrix = ['1', 'Letter', 'BAR', 'VIP1', 'VIP2'];
const payoutMultipliers = { '1': 1, 'Letter': 25, 'BAR': 5, 'VIP1': 15, 'VIP2': 50 };

setInterval(() => {
    if (engineRunning) return;
    let counter = 15;
    
    const countdown = setInterval(() => {
        if (counter > 0) {
            io.emit('timerUpdate', counter);
            counter--;
        } else {
            clearInterval(countdown);
            engineRunning = true;
            
            const rolled = channelMatrix[Math.floor(Math.random() * channelMatrix.length)];
            const targetDegrees = Math.floor(Math.random() * 360) + 2160;
            
            io.emit('triggerSpin', { targetDegrees, rolled });

            setTimeout(() => {
                engineRunning = false;
                
                Object.keys(activeDatabase).forEach(phone => {
                    let userNode = activeDatabase[phone];
                    if (userNode.activeBet > 0) {
                        if (userNode.channels.includes(rolled)) {
                            let winAmount = userNode.activeBet * payoutMultipliers[rolled];
                            let houseCut = winAmount * 0.04;
                            houseBenefitPool += houseCut;
                            userNode.balance += (winAmount - houseCut) + userNode.activeBet;
                        } else {
                            houseBenefitPool += userNode.activeBet * 0.04;
                        }
                        userNode.activeBet = 0;
                        userNode.channels = [];
                    }
                });
                io.emit('syncData', { database: activeDatabase, houseVault: houseBenefitPool });
            }, 6000);
        }
    }, 1000);
}, 25000);

io.on('connection', (socket) => {
    socket.on('playerLogin', (phone) => {
        if (!activeDatabase[phone]) {
            activeDatabase[phone] = { balance: 500, activeBet: 0, channels: [], request: null, socketId: socket.id };
        } else {
            activeDatabase[phone].socketId = socket.id;
        }
        io.emit('syncData', { database: activeDatabase, houseVault: houseBenefitPool });
    });

    socket.on('submitBet', ({ phone, betAmount, channels }) => {
        let userNode = activeDatabase[phone];
        if (userNode && userNode.balance >= betAmount && !engineRunning) {
            userNode.balance -= betAmount;
            userNode.activeBet = betAmount;
            userNode.channels = channels;
            io.emit('syncData', { database: activeDatabase, houseVault: houseBenefitPool });
        }
    });

    socket.on('submitGatewayRequest', ({ phone, type, amount }) => {
        if (activeDatabase[phone]) {
            activeDatabase[phone].request = { type, amount };
            io.emit('syncData', { database: activeDatabase, houseVault: houseBenefitPool });
        }
    });

    socket.on('adminAction', ({ phone, permitted }) => {
        const targetNode = activeDatabase[phone];
        if (targetNode && targetNode.request) {
            if (permitted) {
                if (targetNode.request.type === 'deposit') targetNode.balance += targetNode.request.amount;
                if (targetNode.request.type === 'withdraw') targetNode.balance -= targetNode.request.amount;
            }
            targetNode.request = null;
            io.emit('syncData', { database: activeDatabase, houseVault: houseBenefitPool });
        }
    });
});

http.listen(process.env.PORT || 3000, () => { console.log('Server Running!'); });
