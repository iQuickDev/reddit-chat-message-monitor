const { Builder, until, By } = require('selenium-webdriver');
const chrome = require('selenium-webdriver/chrome');
const Database = require('./database');
const fs = require('fs');
const path = require('path');

let processedMessages = new Set();

async function monitorMessages(driver, db) {
    console.log('Starting message monitoring...');
    
    setInterval(async () => {
        try {
            const messages = await driver.executeScript(`
                const timeline = document.querySelector("body > faceplate-app > rs-app")?.shadowRoot
                    ?.querySelector("div.rs-app-container > div > rs-page-overlay-manager > rs-room")?.shadowRoot
                    ?.querySelector("main > rs-timeline")?.shadowRoot
                    ?.querySelector("div > rs-virtual-scroll-dynamic")?.shadowRoot
                    ?.querySelectorAll("rs-timeline-event");
                
                if (!timeline) return [];
                
                return Array.from(timeline).map(event => {
                    const dataId = event.getAttribute('data-id');
                    const username = event.shadowRoot?.querySelector('rs-username')?.textContent?.trim();
                    const content = event.shadowRoot?.querySelector('.room-message-text')?.textContent?.trim();
                    return { dataId, username, content };
                }).filter(msg => msg.dataId && msg.username && msg.content);
            `);
            
            for (const message of messages) {
                if (!processedMessages.has(message.dataId)) {
                    const inserted = await db.insertMessage(message.dataId, message.username, message.content);
                    if (inserted) {
                        await db.updateUserStats(message.username);
                        console.log(`${message.username}: ${message.content}`);
                    }
                    processedMessages.add(message.dataId);
                }
            }
        } catch (error) {
            console.error('Error monitoring messages:', error.message);
        }
    }, 5000);
}

async function openReddit() {
    const db = new Database();
    await db.init();
    
    console.log('Starting browser...');
    const path = require('path');
    const userDataDir = path.join(__dirname, 'chrome-user-data');
    
    const options = new chrome.Options();
    options.addArguments(`--user-data-dir=${userDataDir}`);
    options.addArguments('--no-sandbox');
    options.addArguments('--disable-dev-shm-usage');
    options.addArguments('--disable-gpu');
    options.addArguments('--headless');
    
    const driver = await new Builder()
        .forBrowser('chrome')
        .setChromeOptions(options)
        .build();
    
    console.log('Browser started successfully');
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    console.log('Browser ready, attempting navigation...');
    const url = 'https://chat.reddit.com/room/!7H3QfsLhRXalKvwGiIDjrw%3Areddit.com';
    
    try {
        console.log('Using driver.get()...');
        await driver.get(url);
        console.log('Navigation complete');
    } catch (error) {
        console.log('driver.get() failed, trying executeScript...');
        await driver.executeScript(`window.location.href = '${url}';`);
        console.log('executeScript navigation complete');
    }
    
    await new Promise(resolve => setTimeout(resolve, 3000));
    
    // Create state directory
    const stateDir = path.join(__dirname, 'state');
    if (!fs.existsSync(stateDir)) {
        fs.mkdirSync(stateDir);
    }
    
    // Start screenshot capture
    setInterval(async () => {
        try {
            const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
            const screenshot = await driver.takeScreenshot();
            fs.writeFileSync(path.join(stateDir, `${timestamp}.png`), screenshot, 'base64');
        } catch (error) {
            console.error('Screenshot error:', error.message);
        }
    }, 30000);
    
    await monitorMessages(driver, db);
    
    // await driver.quit();
    // db.close();
}

openReddit().catch(err => {
    console.error('Error:', err.message);
    process.exit(1);
});