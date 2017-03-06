/**
 * This file is part of Adguard Browser Extension (https://github.com/AdguardTeam/AdguardBrowserExtension).
 *
 * Adguard Browser Extension is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Lesser General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * Adguard Browser Extension is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Lesser General Public License for more details.
 *
 * You should have received a copy of the GNU Lesser General Public License
 * along with Adguard Browser Extension.  If not, see <http://www.gnu.org/licenses/>.
 */

/* global Promise */

/**
 * Adguard sync settings provider
 * Documentation: TODO: link
 */
(function (api, adguard) { // jshint ignore:line

    'use strict';

    var CLIENT_ID = 'adguard-browser-extension';
    var PROVIDER_NAME = 'ADGUARD_SYNC';

    var AdguardClient = (function () {

        var DEFAULT_PING_TIMEOUT = 40 * 1000;

        var SYNC_TIMESTAMP_PROP = 'adguard-provider-sync-timestamp';
        var syncTimestamp = null;

        var httpApiEndpoint = 'http://testsync.adguard.com/1';
        var wsApiEndpoint = 'ws://testsync.adguard.com/1';

        var webSocket;
        var checkConnectionTimeoutId;
        var pingTimeout = DEFAULT_PING_TIMEOUT;
        var lastPingTime;

        function getSyncTimestamp() {
            if (syncTimestamp === null) {
                syncTimestamp = parseInt(adguard.localStorage.getItem(SYNC_TIMESTAMP_PROP) || 0);
            }
            return syncTimestamp;
        }

        function updateSyncTimestamp(timestamp) {
            if (timestamp !== getSyncTimestamp()) {
                syncTimestamp = timestamp;
                adguard.localStorage.setItem(SYNC_TIMESTAMP_PROP, timestamp);
                return true;
            }
            return false;
        }

        var webSocketConnect = function () {

            webSocketDisconnect();

            lastPingTime = Date.now() - DEFAULT_PING_TIMEOUT + Math.floor(DEFAULT_PING_TIMEOUT / 4);

            if (!api.oauthService.isAuthorized(PROVIDER_NAME)) {
                return;
            }

            initWebSocketConnection();
            watchConnectionIsAlive();
        };

        function initWebSocketConnection() {
            webSocket = new WebSocket(wsApiEndpoint + '/websocket?authorization=' + api.oauthService.getToken(PROVIDER_NAME));
            webSocket.onopen = function () {
                lastPingTime = Date.now();
            };
            webSocket.onmessage = function (e) {
                pingTimeout = DEFAULT_PING_TIMEOUT;
                onWebSocketMessage(e.data);
            };
        }

        function onWebSocketMessage(data) {
            try {
                var message = JSON.parse(data);
                if (message.type === 'ping') {
                    lastPingTime = Date.now();
                }
                if (message.type === 'push' && updateSyncTimestamp(message.timestamp)) {
                    adguard.listeners.notifyListeners(adguard.listeners.SYNC_REQUIRED);
                }
            } catch (e) {
                adguard.console.error('Adguard sync error {0}', e);
            }
        }

        function watchConnectionIsAlive() {
            if (checkConnectionTimeoutId) {
                clearInterval(checkConnectionTimeoutId);
            }
            checkConnectionTimeoutId = setInterval(function () {
                if (Date.now() - lastPingTime > pingTimeout) {
                    adguard.console.info('Have not seen ping message, reconnecting');
                    pingTimeout = Math.min(10 * 60 * 1000, pingTimeout * 2);
                    webSocketConnect();
                }
            }, 5 * 1000);
        }

        function webSocketDisconnect() {
            if (webSocket) {
                webSocket.close();
                webSocket = null;
            }
            if (checkConnectionTimeoutId) {
                clearInterval(checkConnectionTimeoutId);
            }
        }

        function makeRequest(url, options) {

            return new Promise(function (resolve, reject) {

                var xhr = new XMLHttpRequest();

                var params = options.params || {};
                var headers = options.headers || {};
                var requestProps = options.requestProps || {};
                var body = options.body;

                var query = [];
                Object.keys(params).forEach(function (key) {
                    query.push(key + '=' + encodeURIComponent(params[key]));
                });
                if (query.length > 0) {
                    url += '?' + query.join('&');
                }
                xhr.open('POST', url, true);

                if ('accessToken' in options) {
                    xhr.setRequestHeader('Authorization', 'Bearer ' + options.accessToken);
                }
                Object.keys(headers).forEach(function (key) {
                    xhr.setRequestHeader(key, headers[key]);
                });
                Object.keys(requestProps).forEach(function (key) {
                    xhr[key] = requestProps[key];
                });

                xhr.onload = function () {
                    var status = xhr.status;
                    if (status === 200) {
                        if (xhr.responseType === 'blob') {
                            var fileReader = new FileReader();
                            fileReader.onload = function () {
                                try {
                                    resolve(JSON.parse(this.result));
                                } catch (ex) {
                                    reject({error: ex});
                                }
                            };
                            fileReader.onerror = function (error) {
                                reject({error: error});
                            };
                            fileReader.readAsText(xhr.response);
                        } else {
                            resolve(xhr.responseText);
                        }
                    } else {
                        reject({status: status, error: new Error(xhr.statusText)});
                    }
                };

                xhr.onerror = function () {
                    reject({status: xhr.status, error: new Error(xhr.statusText)});
                };

                xhr.send(body);
            });
        }

        function syncFiles() {
            return makeRequest(httpApiEndpoint + '/files/sync', {
                accessToken: api.oauthService.getToken(PROVIDER_NAME)
            });
        }

        var filesDownload = function (name) {
            return makeRequest(httpApiEndpoint + '/files/download', {
                accessToken: api.oauthService.getToken(PROVIDER_NAME),
                headers: {
                    'Adguard-API-Arg': JSON.stringify({name: name})
                },
                requestProps: {responseType: 'blob'}
            });
        };

        var filesUpload = function (name, contents) {
            return makeRequest(httpApiEndpoint + '/files/upload', {
                accessToken: api.oauthService.getToken(PROVIDER_NAME),
                headers: {
                    'Content-Type': 'application/octet-stream',
                    'Adguard-API-Arg': JSON.stringify({name: name})
                },
                body: contents
            }).then(JSON.parse).then(function (file) {
                // Upload local timestamp
                updateSyncTimestamp(file.modified);
            });
        };

        var init = function () {
            syncFiles()
                .then(JSON.parse)
                .then(function (sync) {
                    if (updateSyncTimestamp(sync.timestamp)) {
                        adguard.listeners.notifyListeners(adguard.listeners.SYNC_REQUIRED);
                    }
                })
                .catch(function (error) {
                    adguard.console.error('Adguard sync error {0}', error);
                });
            // Open websocket connection for receiving notifications
            webSocketConnect();
        };

        var getAuthenticationUrl = function (redirectUri) {
            var params = {
                client_id: CLIENT_ID,
                redirect_uri: redirectUri,
                response_type: 'token'
            };
            var query = [];
            Object.keys(params).forEach(function (key) {
                query.push(key + '=' + encodeURIComponent(params[key]));
            });
            return httpApiEndpoint + '/oauth2/authorize?' + query.join('&');
        };

        var shutdown = function () {
            webSocketDisconnect();
        };

        return {
            filesDownload: filesDownload,
            filesUpload: filesUpload,
            init: init,
            getAuthenticationUrl: getAuthenticationUrl,
            shutdown: shutdown
        };

    })();

    var load = function (name, callback) {

        AdguardClient.filesDownload(name)
            .then(function (response) {
                callback(response);
            })
            .catch(function (error) {
                if (error.status === 404) {
                    callback(null);
                } else {
                    adguard.console.error('Adguard sync error {0}', error);
                    callback(false);
                }
            });
    };

    var save = function (name, data, callback) {
        var contents = JSON.stringify(data);
        AdguardClient.filesUpload(name, contents)
            .then(function () {
                callback(true);
            })
            .catch(function (error) {
                adguard.console.error('Adguard sync error {0}', error);
                callback(false);
            });
    };

    var init = function () {
        AdguardClient.init();
    };

    var shutdown = function () {
        AdguardClient.shutdown();
    };

    var getAuthUrl = function (redirectUri) {
        return AdguardClient.getAuthenticationUrl(redirectUri);
    };

    // EXPOSE
    api.adguardSyncProvider = {
        get name() {
            return PROVIDER_NAME;
        },
        get oauthSupported() {
            return true;
        },
        // Storage api
        load: load,
        save: save,
        init: init,
        shutdown: shutdown,
        // Auth api
        getAuthUrl: getAuthUrl
    };

})(adguard.sync, adguard);