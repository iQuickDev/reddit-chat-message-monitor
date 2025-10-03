const { Builder, until, By } = require('selenium-webdriver');
const chrome = require('selenium-webdriver/chrome');
const Database = require('./database');
const fs = require('fs');
const path = require('path');

let processedMessages = new Set();

async function monitorMessages(driver, db) {
    console.log('Starting message monitoring...');
    
    setInterval(async () => {
        console.log('Starting message check...');
        try {
            const messages = await driver.executeScript(`
                const app = document.querySelector("body > faceplate-app > rs-app");
                console.log('App element:', !!app);
                if (!app) return { debug: 'No app element', messages: [] };
                
                const appShadow = app.shadowRoot;
                console.log('App shadow:', !!appShadow);
                if (!appShadow) return { debug: 'No app shadow', messages: [] };
                
                const room = appShadow.querySelector("div.rs-app-container > div > rs-page-overlay-manager > rs-room");
                console.log('Room element:', !!room);
                if (!room) return { debug: 'No room element', messages: [] };
                
                const roomShadow = room.shadowRoot;
                console.log('Room shadow:', !!roomShadow);
                if (!roomShadow) return { debug: 'No room shadow', messages: [] };
                
                const timeline = roomShadow.querySelector("main > rs-timeline");
                console.log('Timeline element:', !!timeline);
                if (!timeline) return { debug: 'No timeline element', messages: [] };
                
                const timelineShadow = timeline.shadowRoot;
                console.log('Timeline shadow:', !!timelineShadow);
                if (!timelineShadow) return { debug: 'No timeline shadow', messages: [] };
                
                const virtualScroll = timelineShadow.querySelector("div > rs-virtual-scroll-dynamic");
                console.log('Virtual scroll element:', !!virtualScroll);
                if (!virtualScroll) return { debug: 'No virtual scroll element', messages: [] };
                
                const virtualScrollShadow = virtualScroll.shadowRoot;
                console.log('Virtual scroll shadow:', !!virtualScrollShadow);
                if (!virtualScrollShadow) return { debug: 'No virtual scroll shadow', messages: [] };
                
                const events = virtualScrollShadow.querySelectorAll("rs-timeline-event");
                console.log('Timeline events found:', events.length);
                
                const messages = Array.from(events).map(event => {
                    const dataId = event.getAttribute('data-id');
                    const username = event.shadowRoot?.querySelector('rs-username')?.textContent?.trim();
                    const content = event.shadowRoot?.querySelector('.room-message-text')?.textContent?.trim();
                    return { dataId, username, content };
                }).filter(msg => msg.dataId && msg.username && msg.content);
                
                return { debug: 'Success', messages };
            `);
            
            console.log('Debug info:', messages.debug);
            const messageList = messages.messages || [];
            console.log('Found ' + messageList.length + ' messages');

            for (const message of messageList) {
                if (!processedMessages.has(message.dataId)) {
                    const inserted = await db.insertMessage(message.dataId, message.username, message.content);
                    if (inserted) {
                        console.log('Saved message ' + message.dataId);
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
    options.addArguments('--window-size=1920,1080');
    
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
    
    // Wait for page to load and check structure
    console.log('Waiting for page to load...');
    await new Promise(resolve => setTimeout(resolve, 10000));
    
    // Debug page structure
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
    
    await monitorMessages(driver, db);
    
    // await driver.quit();
    // db.close();
}

openReddit().catch(err => {
    console.error('Error:', err.message);
    process.exit(1);
});