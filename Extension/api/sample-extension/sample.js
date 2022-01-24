/* eslint-disable no-console */

/* global adguardApi */

// Init the configuration
import { webRequestService } from '../../src/background/filter/request-blocking';
import { utils } from '../../src/background/utils/common';

const configuration = {
    // Adguard English filter alone
    filters: [2],

    // Adguard is disabled on www.avira.com
    whitelist: ['www.avira.com'],

    // Array of custom rules
    rules: ['example.org##h1'],

    // Filters metadata file path
    filtersMetadataUrl: 'https://filters.adtidy.org/extension/chromium/filters.json',

    // Filter file mask
    filterRulesUrl: 'https://filters.adtidy.org/extension/chromium/filters/{filter_id}.txt',
};

// Add event listener for blocked requests
const onBlocked = function (details) {
    console.log(details);
};

adguardApi.onRequestBlocked.addListener(onBlocked);

// Add event listener for rules created by Adguard Assistant
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    console.log({ message, sender });
    if (message.type === 'assistant-create-rule') {
        const { ruleText } = message.data;
        console.log(`Rule ${ruleText} was created by Adguard Assistant`);
        configuration.rules.push(ruleText);
        adguardApi.configure(configuration, () => {
            console.log('Finished Adguard API re-configuration');
        });
    } else if (message.type === 'getSelectorsAndScripts') {
        let urlForSelectors;
        // https://github.com/AdguardTeam/AdguardBrowserExtension/issues/1498
        // when document url for iframe is about:blank then we use tab url
        if (!utils.url.isHttpOrWsRequest(message.documentUrl) && sender.frameId !== 0) {
            urlForSelectors = sender.tab.url;
        } else {
            urlForSelectors = message.documentUrl;
        }
        const response = webRequestService.processGetSelectorsAndScripts(sender.tab, urlForSelectors) || {};
        console.log(response);
        sendResponse(response);
    }
});

adguardApi.start(configuration, () => {
    console.log('Finished Adguard API initialization.');

    // Now we want to disable Adguard on www.google.com
    configuration.whitelist.push('www.google.com');
    adguardApi.configure(configuration, () => {
        console.log('Finished Adguard API re-configuration');
    });
});

// Disable Adguard in 1 minute
setTimeout(() => {
    adguardApi.onRequestBlocked.removeListener(onBlocked);
    adguardApi.stop(() => {
        console.log('Adguard API has been disabled.');
    });
}, 10 * 1000);
