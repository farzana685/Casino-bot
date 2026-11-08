const admin = require("firebase-admin");

// রেন্ডার এনভায়রনমেন্ট ভেরিয়েবল থেকে সরাসরি সিক্রেট কী অবজেক্ট নেওয়া
const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: "https://firebasedatabase.app"
});

const db = admin.database();
let timerSeconds = 30;

// গেমের ২০টি সেগমেন্ট (আপনার কনফিগারেশন অনুযায়ী)
const segments = [
    { name: "1", multiplier: 1, color: "#ff007f", isBonus: false },
    { name: "2", multiplier: 2, color: "#7f00ff", isBonus: false },
    { name: "FUNKY", multiplier: 25, color: "#ffcc00", isBonus: true },
    { name: "1", multiplier: 1, color: "#ff007f", isBonus: false },
    { name: "2", multiplier: 2, color: "#7f00ff", isBonus: false },
    { name: "PLAY", multiplier: 15, color: "#00ff66", isBonus: true },
    { name: "1", multiplier: 1, color: "#ff007f", isBonus: false },
    { name: "STAYIN", multiplier: 50, color: "#00ff66", isBonus: true },
    { name: "2", multiplier: 2, color: "#7f00ff", isBonus: false },
    { name: "VIP", multiplier: 100, color: "#ff0000", isBonus: true },
    { name: "1", multiplier: 1, color: "#ff007f", isBonus: false },
    { name: "DANCE", multiplier: 20, color: "#ff007f", isBonus: true },
    { name: "2", multiplier: 2, color: "#7f00ff", isBonus: false },
    { name: "1", multiplier: 1, color: "#ff007f", isBonus: false },
    { name: "MAX PRO", multiplier: 80, color: "#00ffff", isBonus: true },
    { name: "2", multiplier: 2, color: "#7f00ff", isBonus: false },
    { name: "1", multiplier: 1, color: "#ff007f", isBonus: false },
    { name: "FUNKY", multiplier: 25, color: "#ffcc00", isBonus: true },
    { name: "2", multiplier: 2, color: "#7f00ff", isBonus: false },
    { name: "VIP", multiplier: 100, color: "#ff0000", isBonus: true }
];

console.log("🚀 ক্যাসিনো ব্যাকএন্ড টাইমার এবং ডিপোজিট বট চালু হয়েছে...");

// ১. গেম টাইমার লুপ (প্রতি সেকেন্ডে চলে)
setInterval(async () => {
    timerSeconds--;
    if (timerSeconds < 0) {
        timerSeconds = 30;
    }
    
    // ডাটাবেজে টাইমার আপডেট
    await db.ref("gameState/timer").set(timerSeconds);
    
    if (timerSeconds === 10) {
        console.log("🔒 ১০ সেকেন্ড শেষ! বাজি অটো-লক করা হলো।");
    }
    
    if (timerSeconds === 0) {
        console.log("🎰 চাকা ঘুরছে! লাভ ও হাউজ এজ হিসাব করা হচ্ছে...");
        calculateHouseEdgeResult();
    }
}, 1000);

// হাউজ প্রফিট (২০% এজ) হিসাবের মূল অ্যালগরিদম
async function calculateHouseEdgeResult() {
    try {
        const snapshot = await db.ref("active_bets").once("value");
        const bets = snapshot.val() || {};
        
        let totalBetAmount = 0;
        let expectedPayouts = new Array(segments.length).fill(0);
        
        for (let betId in bets) {
            const bet = bets[betId];
            const amount = parseFloat(bet.betAmount) || 0;
            const selected = parseInt(bet.selectedOption);
            
            totalBetAmount += amount;
            if (selected >= 0 && selected < segments.length) {
                expectedPayouts[selected] += (amount * segments[selected].multiplier) + amount;
            }
        }
        
        const maxAllowedPayout = 0.8 * totalBetAmount;
        let safeWinningIndexes = [];
        
        segments.forEach((segment, index) => {
            if (expectedPayouts[index] <= maxAllowedPayout || totalBetAmount === 0) {
                safeWinningIndexes.push(index);
            }
        });
        
        let winningIndex = 0;
        if (safeWinningIndexes.length > 0) {
            winningIndex = safeWinningIndexes[Math.floor(Math.random() * safeWinningIndexes.length)];
        } else {
            winningIndex = expectedPayouts.indexOf(Math.min(...expectedPayouts));
        }
        
        const actualPayout = expectedPayouts[winningIndex];
        const roundProfit = totalBetAmount - actualPayout;

        if (totalBetAmount > 0) {
            const profitRef = db.ref("gameState/totalHouseProfit");
            await profitRef.transaction((currentProfit) => {
                return (currentProfit || 0) + roundProfit;
            });
            console.log(`💰 এই রাউন্ডের প্রফিট: ${roundProfit} টাকা ফায়ারবেসে যোগ হয়েছে।`);
        }
        
        await db.ref("gameState/winningIndex").set(winningIndex);
        console.log(`🔮 উইনিং ইনডেক্স: ${winningIndex} (${segments[winningIndex].name})`);
        
        setTimeout(async () => {
            await db.ref("active_bets").remove();
            await db.ref("gameState/winningIndex").remove();
            console.log("🧹 নতুন রাউন্ডের জন্য বেটিং বোর্ড আনলক করা হয়েছে।");
        }, 5000);
        
    } catch (error) {
        console.error("Error in wheel algorithm: ", error);
    }
}

// ২. ডিপোজিট রিকোয়েস্ট ও ম্যানুয়াল অ্যাডমিন অ্যাপ্রুভাল সিস্টেম
db.ref("deposit_requests").on("child_changed", async (snapshot) => {
    const requestId = snapshot.key;
    const requestData = snapshot.val();

    if (requestData && requestData.status === "approved" && !requestData.processed) {
        const username = requestData.username;
        const depositAmount = parseFloat(requestData.amount) || 0;

        try {
            const usersSnapshot = await db.ref("users").once("value");
            const users = usersSnapshot.val() || {};
            
            let targetUid = null;
            for (let uid in users) {
                if (users[uid].username === username) {
                    targetUid = uid;
                    break;
                }
            }

            if (targetUid) {
                const userBalanceRef = db.ref(`users/${targetUid}/balance`);
                await userBalanceRef.transaction((currentBalance) => {
                    return (currentBalance || 0) + depositAmount;
                });

                await db.ref(`deposit_requests/${requestId}`).update({
                    processed: true,
                    status: "success"
                });

                console.log(`✅ Approved: ${username} এর মেইন ব্যালেন্সে ${depositAmount} টাকা যোগ হয়েছে।`);
            } else {
                console.log(`❌ Error: Username '${username}' খুঁজে পাওয়া যায়নি!`);
            }
        } catch (error) {
            console.error("Deposit approval error: ", error);
        }
    }
});
