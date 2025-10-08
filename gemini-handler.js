const { Builder, By, until } = require('selenium-webdriver');
const chrome = require('selenium-webdriver/chrome');
const path = require('path');

class GeminiHandler
{
    constructor()
    {
        this.driver = null;
        this.isReady = false;
        this.isBusy = false;
        this.queue = [];
        this.processing = false;
    }

    async init()
    {
        console.log('Initializing Gemini handler...');
        const userDataDir = path.join(__dirname, 'gemini-user-data');

        const options = new chrome.Options();
        options.addArguments(`--user-data-dir=${userDataDir}`);
        options.addArguments('--no-sandbox');
        options.addArguments('--headless');
        options.addArguments('--window-size=1920,1080');
        options.excludeSwitches(['enable-automation']);

        this.driver = await new Builder()
            .forBrowser('chrome')
            .setChromeOptions(options)
            .build();

        await this.driver.executeScript('Object.defineProperty(navigator, "webdriver", {get: () => undefined});');

        try
        {
            await this.driver.get('https://gemini.google.com/app?hl=it');
            await new Promise(resolve => setTimeout(resolve, 5000));
            this.isReady = true;
            console.log('Gemini handler ready');
        } catch (error)
        {
            console.error('Failed to initialize Gemini:', error.message);
        }
    }

    async askQuestion(question, username)
    {
        if (!this.isReady || !this.driver)
        {
            throw new Error('Gemini handler not ready');
        }

        return new Promise((resolve) => {
            this.queue.push({ question, username, resolve });
            this.processQueue();
        });
    }

    async processQueue()
    {
        if (this.processing || this.queue.length === 0) return;
        
        this.processing = true;
        
        while (this.queue.length > 0) {
            const { question, username, resolve } = this.queue.shift();
            
            try {
                const response = await this._processQuestion(question);
                resolve(response);
            } catch (error) {
                console.error(`Error processing question for ${username}:`, error);
                resolve('Error getting response');
            }
        }
        
        this.processing = false;
    }

    async _processQuestion(question)
    {
        let prompt = "Questa domanda proviene da una chat di reddit Italiana, rispondi in Italiano, in modo sarcastico, come farebbe un gruppo di ragazzi, non farti problemi a usare termini slag della gen z o andarci piu pesante con gli utenti.\n Questo e il testo della domanda: " + question;
        try
        {
            await this.driver.executeScript(`
                const textArea = document.querySelector("p");
                if (textArea) textArea.textContent = '${prompt}';
            `);

            await new Promise(resolve => setTimeout(resolve, 1000));
            await this.driver.executeScript(`
                Array.from(document.querySelectorAll('mat-icon')).filter(i => (i.getAttribute('data-mat-icon-name') == 'send'))[0].click()
            `);

            await new Promise(resolve => setTimeout(resolve, 10000));
            const response = await this.driver.executeScript(`
                const questions = document.querySelectorAll("user-query");
                const responses = document.querySelectorAll("model-response");
                let responseText = responses.length > 0 ? responses[responses.length - 1].textContent : null
                if (responses.length > 0) {
                    Array.from(responses).forEach(r => r.remove());
                }
                if (questions.length > 0) {
                    Array.from(questions).forEach(q => q.remove());
                }
                return responseText;
            `);

            this.driver.get("https://gemini.google.com/app?hl=it")

            return response || 'No response received'
        } catch (error)
        {
            console.error(error);
            throw error;
        }
    }

    getQueueLength()
    {
        return this.queue.length;
    }

    async close()
    {
        if (this.driver)
        {
            await this.driver.quit();
        }
    }
}

module.exports = GeminiHandler;