const { Builder, By } = require('selenium-webdriver');
const chrome = require('selenium-webdriver/chrome');
const Database = require('./database');
const GrokHandler = require('./grok-handler');
const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv')
const server = require('./server')
dotenv.config();

let processedMessages = new Set();
let grok = null;
const BOT_NAME = process.env.BOT_NAME || 'bot';
const PROCESSED_MESSAGES_FILE = path.join(__dirname, 'state', 'processed-messages.json');

function loadProcessedMessages() {
    try {
        if (fs.existsSync(PROCESSED_MESSAGES_FILE)) {
            const data = JSON.parse(fs.readFileSync(PROCESSED_MESSAGES_FILE, 'utf8'));
            processedMessages = new Set(data);
            console.log(`Loaded ${processedMessages.size} processed messages`);
        }
    } catch (error) {
        console.error('Error loading processed messages:', error.message);
    }
}

function saveProcessedMessages() {
    try {
        fs.writeFileSync(PROCESSED_MESSAGES_FILE, JSON.stringify([...processedMessages]));
    } catch (error) {
        console.error('Error saving processed messages:', error.message);
    }
}

async function sendMessage(driver, message) {
    driver.executeScript(`
        const textarea = document.querySelector("body > faceplate-app > rs-app").shadowRoot.querySelector("div.rs-app-container > div > rs-page-overlay-manager > rs-room").shadowRoot.querySelector("main > rs-message-composer").shadowRoot.querySelector("div > form > div.message-box").querySelector("textarea");
        const sendButton = document.querySelector("body > faceplate-app > rs-app").shadowRoot.querySelector("div.rs-app-container > div > rs-page-overlay-manager > rs-room").shadowRoot.querySelector("main > rs-message-composer").shadowRoot.querySelector("div > form > div.flex.gap-2xs.py-2xs > faceplate-tooltip.ml-auto > button");
        textarea.value = arguments[0];
        textarea.dispatchEvent(new Event('input', { bubbles: true }));
        setTimeout(() => sendButton.click(), 1000);
    `, message)
    }

async function monitorMessages(driver, db) {
    console.log('Starting message monitoring...');
    
    setInterval(async () => {
        try {
            const messages = await driver.executeScript(`
                const app = document.querySelector("body > faceplate-app > rs-app");
                if (!app) return { debug: 'No app element', messages: [] };
                const appShadow = app.shadowRoot;
                if (!appShadow) return { debug: 'No app shadow', messages: [] };
                const room = appShadow.querySelector("div.rs-app-container > div > rs-page-overlay-manager > rs-room");
                if (!room) return { debug: 'No room element', messages: [] };
                const roomShadow = room.shadowRoot;
                if (!roomShadow) return { debug: 'No room shadow', messages: [] };
                const timeline = roomShadow.querySelector("main > rs-timeline");
                if (!timeline) return { debug: 'No timeline element', messages: [] };
                const timelineShadow = timeline.shadowRoot;
                if (!timelineShadow) return { debug: 'No timeline shadow', messages: [] };
                const virtualScroll = timelineShadow.querySelector("div > rs-virtual-scroll-dynamic");
                if (!virtualScroll) return { debug: 'No virtual scroll element', messages: [] };
                const virtualScrollShadow = virtualScroll.shadowRoot;
                if (!virtualScrollShadow) return { debug: 'No virtual scroll shadow', messages: [] };
                const events = virtualScrollShadow.querySelectorAll("rs-timeline-event");
                
                const messages = Array.from(events).map(event => {
                    const username = event.shadowRoot.querySelector('.room-message')?.getAttribute('aria-label').split(' ')[0]
                    const dataId = event.getAttribute('data-id');
                    const content = event.shadowRoot?.querySelector('.room-message-text')?.textContent?.trim();
                    return { dataId, username, content };
                }).filter(msg => msg.dataId && msg.username && msg.content);
                
                return messages;
            `);

            const messageList = messages || [];

            for (const message of messageList) {
                if (!processedMessages.has(message.dataId)) {
                    processedMessages.add(message.dataId);
                    saveProcessedMessages();
                    if (message.content.toLowerCase() === '/dt') {
                        await db.setUserTrackStatus(message.username, 0);
                        console.log(`${message.username} disabled tracking`);
                        await sendMessage(driver, `@${message.username} Tracking messaggi disattivato`);
                    } else if (message.content.toLowerCase() === '/at') {
                        await db.setUserTrackStatus(message.username, 1);
                        console.log(`${message.username} enabled tracking`);
                        await sendMessage(driver, `@${message.username} Tracking messaggi attivato`);
                    }
                    else if (message.content.toLowerCase().includes(`@${BOT_NAME.toLowerCase()}`) || message.content.toLowerCase().includes(BOT_NAME.toLowerCase())) {
                        if (grok && grok.isReady) {
                            console.log(`Bot mentioned by ${message.username}: ${message.content}`);
                            const question = message.content.replace(new RegExp(`@?u/?${BOT_NAME}`, 'gi'), '').trim();
                            if (question) {
                                const queuePos = grok.getQueueLength();
                                if (queuePos > 0) {
                                    await sendMessage(driver, `@${message.username} Question queued (position ${queuePos + 1})`);
                                }
                                try {
                                    const response = await grok.askQuestion(question, message.username);
                                    await sendMessage(driver, `@${message.username} ${response}`);
                                } catch (error) {
                                    console.error('Grok error:', error.message);
                                    await sendMessage(driver, `@${message.username} Sorry, I'm having trouble right now`);
                                }
                            }
                        }
                    }
                    
                    const trackStatus = await db.getUserTrackStatus(message.username);
                    const visible = trackStatus === 1 ? 1 : 0;
                    const inserted = await db.insertMessage(message.dataId, message.username, message.content, visible);
                    if (inserted) {
                        await db.updateUserStats(message.username);
                        console.log(`${message.username}: ${message.content}`);
                    }
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
    
    // Initialize Grok handler
    grok = new GrokHandler();
    await grok.init();
    
    console.log('Starting browser...');
    const userDataDir = path.join(__dirname, 'chrome-user-data');
    
    const options = new chrome.Options();
    options.addArguments(`--user-data-dir=${userDataDir}`);
    options.addArguments('--no-sandbox');
    options.addArguments('--headless');
    options.addArguments('--window-size=1920,1080');
    options.addArguments('--user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
    options.excludeSwitches(['enable-automation']);
    
    const driver = await new Builder()
        .forBrowser('chrome')
        .setChromeOptions(options)
        .build();
    
    await driver.executeScript('Object.defineProperty(navigator, "webdriver", {get: () => undefined});');
    
    await driver.executeScript(`
        Object.defineProperty(navigator, 'plugins', {
            get: () => [1, 2, 3, 4, 5]
        });
        Object.defineProperty(navigator, 'languages', {
            get: () => ['en-US', 'en']
        });
    `);
    
    console.log('Browser started successfully');
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    console.log('Browser ready, attempting navigation...');
    const url = process.env.CHAT_LINK;
    
    try {
        console.log('Using driver.get()...');
        await driver.get(url);
        console.log('Navigation complete');
    } catch (error) {
        console.log('driver.get() failed, trying executeScript...');
        await driver.executeScript(`window.location.href = '${url}';`);
        console.log('executeScript navigation complete');
    }
    
    const stateDir = path.join(__dirname, 'state');
    if (!fs.existsSync(stateDir)) {
        fs.mkdirSync(stateDir);
    }
    
    loadProcessedMessages();

    console.log('Waiting for page to load...');
    await new Promise(resolve => setTimeout(resolve, 3000));

    const pageInfo = await driver.executeScript(`
        return {
            title: document.title,
            url: window.location.href,
            bodyChildren: document.body ? Array.from(document.body.children).map(el => el.tagName) : [],
            faceplateApp: !!document.querySelector('faceplate-app'),
            rsApp: !!document.querySelector('rs-app')
        };
    `);
    
    console.log('Page info:', pageInfo);
    
    if (pageInfo.url.includes('/login/')) {
        console.log('Redirected to login page. Attempting to login...');
        await new Promise(resolve => setTimeout(resolve, 1000));
        await driver.findElement(By.name('username')).sendKeys(process.env.REDDIT_USERNAME);
        await driver.findElement(By.name('password')).sendKeys(process.env.REDDIT_PASSWORD);
        await driver.findElement(By.className('login')).click();
        console.log('Waiting for login to complete...');
        await new Promise(resolve => setTimeout(resolve, 5000));
        await driver.get(url);
        await new Promise(resolve => setTimeout(resolve, 5000));
    }
 
    
    await monitorMessages(driver, db);
    
    // await driver.quit();
    // db.close();
}

openReddit().catch(err => {
    console.error('Error:', err.message);
    process.exit(1);
});