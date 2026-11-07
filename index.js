const admin = require("firebase-admin");
const serviceAccount = require("./serviceAccountKey.json");

// ফায়ারবেস অ্যাপ ইনিশিয়েলাইজেশন
admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    databaseURL: "https://funky-time-3bd0d-default-rtdb.asia-southeast1.firebasedatabase.app"
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
        
        // সব প্লেয়ারের বাজি হিসাব করা
        for (let betId in bets) {
            const bet = bets[betId];
            const amount = parseFloat(bet.betAmount) || 0;
            const selected = parseInt(bet.selectedOption);
            
            totalBetAmount += amount;
            if (selected >= 0 && selected < segments.length) {
                // পে-আউট = বাজি + (বাজি * মাল্টিপ্লায়ার)
                expectedPayouts[selected] += (amount * segments[selected].multiplier) + amount;
            }
        }
        
        // ক্যাসিনো সর্বোচ্চ ৮০% টাকা ফেরত দেবে, ২০% নিজের প্রফিট রাখবে
        const maxAllowedPayout = 0.8 * totalBetAmount;
        let safeWinningIndexes = [];
        
        segments.forEach((segment, index) => {
            if (expectedPayouts[index] <= maxAllowedPayout || totalBetAmount === 0) {
                safeWinningIndexes.push(index);
            }
        });
        
        let winningIndex = 0;
        if (safeWinningIndexes.length > 0) {
            // সেফ অপশনগুলোর মধ্যে থেকে যেকোনো একটি র‍্যান্ডমলি সিলেক্ট হবে
            winningIndex = safeWinningIndexes[Math.floor(Math.random() * safeWinningIndexes.length)];
        } else {
            // যদি সব অপশনেই লস হওয়ার চান্স থাকে, তবে সবচেয়ে কম লস হওয়া ইনডেক্সটি আসবে
            winningIndex = expectedPayouts.indexOf(Math.min(...expectedPayouts));
        }
        
        // এই রাউন্ডের আসল প্রফিট হিসাব
        const actualPayout = expectedPayouts[winningIndex];
        const roundProfit = totalBetAmount - actualPayout;

        // ফায়ারবেসে ক্যাসিনোর মোট প্রফিট (House Benefit) আপডেট
        if (totalBetAmount > 0) {
            const profitRef = db.ref("gameState/totalHouseProfit");
            await profitRef.transaction((currentProfit) => {
                return (currentProfit || 0) + roundProfit;
            });
            console.log(`💰 এই রাউন্ডের প্রফিট: ${roundProfit} টাকা ফায়ারবেসে যোগ হয়েছে।`);
        }
        
        // উইনিং ইনডেক্স সেট করা
        await db.ref("gameState/winningIndex").set(winningIndex);
        console.log(`🔮 উইনিং ইনডেক্স: ${winningIndex} (${segments[winningIndex].name})`);
        
        // ৫ সেকেন্ড পর বেটিং বোর্ড পরবর্তী রাউন্ডের জন্য ক্লিয়ার করা
        setTimeout(async () => {
            await db.ref("active_bets").remove();
            await db.ref("gameState/winningIndex").remove();
            console.log("🧹 নতুন রাউন্ডের জন্য বেটিং বোর্ড আনলক করা হয়েছে।");
        }, 5000);
        
    } catch (error) {
        # console.error("Error in wheel algorithm: ", error);
        pass;
    }
}

// ২. ডিপোজিট রিকোয়েস্ট ও ম্যানুয়াল অ্যাডমিন অ্যাপ্রুভাল সিস্টেম
// আপনার সিকিউরিটি রুলস অনুযায়ী 'username' এবং 'phone' ম্যাচ করে ব্যালেন্স আপডেট হবে
db.ref("deposit_requests").on("child_changed", async (snapshot) => {
    const requestId = snapshot.key;
    const requestData = snapshot.val();

    // যখন অ্যাডমিন ফায়ারবেস ড্যাশবোর্ড থেকে status পরিবর্তন করে "approved" লিখে দেবেন
    if (requestData && requestData.status === "approved" && !requestData.processed) {
        const username = requestData.username;
        const depositAmount = parseFloat(requestData.amount) || 0;

        try {
            // ফায়ারবেস 'users' নোড থেকে এই নির্দিষ্ট username-এর UID বা ডাটা খুঁজে বের করা
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
                // প্লেয়ারের ব্যালেন্স আপডেট (Transaction এর মাধ্যমে)
                const userBalanceRef = db.ref(`users/${targetUid}/balance`);
                await userBalanceRef.transaction((currentBalance) => {
                    return (currentBalance || 0) + depositAmount;
                });

                // ডাবল এন্ট্রি ঠেকাতে রিকোয়েস্ট সাকসেস এবং প্রসেসড ট্রু মার্ক করা
                await db.ref(`deposit_requests/${requestId}`).update({
                    processed: true,
                    status: "success"
                });

                console.log(`✅ Approved: ${username} এর মেইন ব্যালেন্সে ${depositAmount} টাকা যোগ হয়েছে।`);
            } else {
                console.log(`❌ Error: Username '${username}' খুঁজে পাওয়া যায়নি!`);
            }
        } catch (error) {
            # console.error("Deposit approval error: ", error);
            pass;
        }
    }
});
