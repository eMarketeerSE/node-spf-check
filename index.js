'use strict';

const dns = require('dns');
const util = require('util');

const spfParse = require('spf-parse');
const ipaddr = require('ipaddr.js');
const tlsjs = require('tldjs');
const _ = require('lodash');

/** Result messages. */
const messages = {
    None: 'Cannot assert whether or not the client host is authorized',
    Neutral: 'Domain owner has explicitly stated that he cannot or does not want to assert whether or not the IP address is authorized',
    Pass: 'Client is authorized to inject mail with the given identity',
    Fail: 'Client is *not* authorized to use the domain in the given identity',
    SoftFail: 'Domain believes the host is not authorized but is not willing to make that strong of a statement',
    TempError: 'Encountered a transient error while performing the check',
    PermError: 'Domain\'s published records could not be correctly interpreted',
};

/**
 * @typedef ResultEnum
 * @property {string} None "None"
 * @property {string} Neutral "Neutral"
 * @property {string} Pass "Pass"
 * @property {string} Fail "Fail"
 * @property {string} SoftFail "SoftFail"
 * @property {string} TempError "TempError"
 * @property {string} PermError "PermError"
 */
/**
 * @type {ResultEnum} results
 */
const results = _.mapValues(messages, _.nthArg(1));

class SPFResult {
    /**
     * @property {string} result - An string value of results constant. available values: None, Neutral, Pass, Fail, SoftFail, TempError, PermError.
     * @property {string} message - Description text.
     */
    constructor(result, message) {
        if (!_.has(results, result)) {
            throw TypeError('Result "' + result + '" not found');
        }

        if (!_.isString(message) || _.isEmpty(message)) {
            message = messages[result];
        }


        /**
         * @type {"None"|"Neutral"|"Pass"|"Fail"|"SoftFail"|"TempError"|"PermError"}
         * @public
         */
        this.result = result;

        /**
         * @type {string}
         * @public
         */
        this.message = message;

        /** Last matched mechanism or "default" if none. Used in Received-SPF
         *  header field. */
        this.mechanism = "default";

        /** List of all matched mechanisms (order from last to first). */
        this.matched = [];
    }
}

/**
 * @typedef {Object} SPFOptions
 * @property {number} [version=1] - SPF version, conforms to https://tools.ietf.org/html/rfc4408
 * @property {boolean} [prefetch=false] - Resolve all mechanisms before evaluating them.
 * This will cause many DNS queries to be made and possible hit the 10 queries hard limit.
 * Note that "redirect" mechanisms always resolve first no matter the value of this option.
 * @property {number} [maxDNS=10] - Hard limit on the number of DNS lookups, including any lookups
 * caused by the use of the "include" mechanism or the "redirect" modifier.
 */

class SPF {
    /**
     * @param {string} domain - Domain to check.
     * @param {string} [sender] - Sender email address.
     * @param {SPFOptions} [options]
     */
    constructor(domain, sender, options) {
        if (_.isObject(domain) && _.isUndefined(sender) && _.isUndefined(options)) {
            options = domain;
            domain = undefined;
        } else if (_.isObject(sender) && _.isUndefined(options)) {
            options = sender;
            sender = undefined;
        }

        this.domain = _.isString(domain) ? domain : _.result(options, 'domain', () => {
            throw new Error('Undefined domain');
        });

        this.sender = _.isString(sender) ? sender : _.get(options, 'sender', 'postmaster@' + this.domain);

        // If the sender has no localpart, substitute the string "postmaster"
        // for the localpart.
        if (!_.includes(this.sender, '@')) {
            this.sender = 'postmaster@' + this.sender;
        }

        this.warnings = [];
        this.queryDNSCount = 0;

        this.options = {
            /** Conforms to https://tools.ietf.org/html/rfc4408 */
            version: 1,

            /** Resolve all mechanisms before evaluating them. This will cause
             *  many DNS queries to be made and possible hit the 10 queries hard
             *  limit. Note that "redirect" mechanisms always resolves first no
             *  matter the value of this option.
             */
            prefetch: false,

            /** Hard limit on the number of DNS lookups, including any lookups
             *  caused by the use of the "include" mechanism or the "redirect"
             *  modifier. */
            maxDNS: 10,

            ...options,
        };
    }

    async resolveMX(hostname, rrtype) {
        // First performs an MX lookup.
        const exchanges = await this.resolveDNS(hostname, 'MX');

        // Check the number of exchanges to retrieve A records and limit before
        // doing any DNS lookup.
        if (exchanges.length >= this.options.maxDNS) {
            throw new SPFResult(results.PermError, 'Limit of DNS lookups reached when processing MX mechanism');
        }

        // Then it performs an address lookup on each MX name returned.
        for (let e = 0; e < exchanges.length; e++) {
            exchanges[e].records = await this.resolveDNS(exchanges[e].exchange, rrtype, /*lookupLimit=*/false);
        };

        return _.sortBy(exchanges, 'priority');
    }

    async resolveDNS(hostname, rrtype, lookupLimit) {
        // Default behaviour is to throw PermError when limit is reached.
        lookupLimit = _.isNil(lookupLimit) || lookupLimit === true;

        if (lookupLimit && this.queryDNSCount >= this.options.maxDNS) {
            throw new SPFResult(results.PermError, 'Limit of DNS lookups reached');
        }

        return new Promise((resolve, reject) => {
            dns.resolve(hostname, rrtype, (err, records) => {
                lookupLimit && this.queryDNSCount++;

                if (err) {
                    // If the DNS lookup returns "domain does not exist",
                    // immediately returns the result "None".
                    if ((new RegExp('queryTxt (ENOTFOUND|ENODATA) ' + hostname)).test(err.message)) {
                        reject(new SPFResult(results.None, 'Domain does not exists'));
                    } else {
                        reject(new SPFResult(results.TempError, err.message));
                    }
                } else {
                    if (rrtype === 'TXT') {
                        resolve(_.map(records, record => {
                            return _.join(record, '');
                        }));
                    } else {
                        resolve(records);
                    }
                }
            });
        });
    }

    async resolveSPF(hostname, rrtype) {
        // TODO resolve SPF record and use them instead of TXT if exists

        const records = _.filter(await this.resolveDNS(hostname, 'TXT'), record => {
            // Records that do not begin with a version section are discarded.
            return _.startsWith(record, 'v=spf' + this.options.version + ' ');
        });

        if (records.length === 0) {
            throw new SPFResult(results.None, 'Assume that the domain makes no SPF declarations');
        }

        if (records.length > 1) {
            throw new SPFResult(results.PermError, 'There should be exactly one record remaining');
        }

        const record = records.pop();

        if (/[^\x00-\x7f]/.test(record)) {
            throw new SPFResult(results.PermError, 'Character content of the record should be encoded as US-ASCII');
        }

        const parsed = spfParse(record);

        if (parsed.valid === false) {
            throw new SPFResult(results.PermError, 'There shouldn\'t be any syntax errors');
        }

        if (_.has(parsed, 'messages')) {
           const errors = _.filter(parsed.messages, ['type', 'error']);

           if (errors.length > 0) {
               // When multiple parse errors are found, return the first one so
               // they can be fixed one at the time.
               throw new SPFResult(results.PermError, errors.shift().message);
           }

           this.warnings = _.concat(this.warnings, _.map(_.filter(parsed.messages, ['type', 'warning']), 'message'));
        }

        // True when there is an "all" mechanism.
        const catchAll = _.some(parsed.mechanisms, ['type', 'all']);

        // List of parsed/resolved mechanisms to be returned.
        let resolved = [];

        for (let i = 0; i < parsed.mechanisms.length; i++) {
            // Parsed mechanisms to be resolved recursively.
            const mechanism = parsed.mechanisms[i];

            if (mechanism.type === 'redirect') {
                if (!catchAll) {
                    // Any "redirect" modifier has effect only when there is
                    // not an "all" mechanism.
                    resolved = _.concat(resolved, await this.resolveSPF(mechanism.value, rrtype));
                }

                continue;
            }

            if (mechanism.type === 'a') {
                mechanism.resolve = async () => {
                    return { records: await this.resolveDNS(mechanism.value || hostname, rrtype) };
                };
            }

            if (mechanism.type === 'mx') {
                mechanism.resolve = async () => {
                    return { exchanges: await this.resolveMX(mechanism.value || hostname, rrtype) };
                };
            }

            if (mechanism.type === 'ip4' || mechanism.type === 'ip6') {
                // If ip4-cidr-length is omitted, it is taken to be "/32".
                // If ip6-cidr-length is omitted, it is taken to be "/128".
                if (mechanism.value.indexOf('/') === -1) {
                    mechanism.value += mechanism.type === 'ip4' ? '/32' : '/128';
                }

                try {
                    mechanism.address = ipaddr.parseCIDR(mechanism.value);
                } catch (err) {
                    throw new SPFResult(results.PermError, 'Malformed "' + mechanism.type + '" address');
                }
            }

            if (mechanism.type === 'include') {
                mechanism.resolve = async () => {
                    return { includes: await this.resolveSPF(mechanism.value, rrtype) };
                };
            }

            if (this.options.prefetch && mechanism.resolve) {
                // Early fetch all DNS records before any evaluation. Will fail
                // fast in some cases that will pass without.
                _.assign(mechanism, await mechanism.resolve());
            }

            resolved.push(mechanism);

            if (mechanism.type === 'all') {
                break; // Mechanisms after "all" will never be resolved.
            }
        }

        return resolved;
    }



    async getMechanisms(rrtype) {
        // List of parsed mechanisms done by `spf-parse` module. Each value is
        // an object that contains type and value.
        let mechanisms;
        try {
            mechanisms = await this.resolveSPF(this.domain, rrtype);
        } catch (err) {
            if (err instanceof SPFResult) {
                throw err;
            }

            throw new SPFResult(results.TempError, err.message);
        }

        if (mechanisms.length === 0) {
            // This is a last minute check that may never get called because
            // there should always be the version mechanism.
            throw new SPFResult(results.TempError, 'No mechanisms found');
        }
        return mechanisms;
    }

    async check(ip) {
        if (!ipaddr.isValid(ip)) {
            return new SPFResult(results.None, 'Malformed IP for comparison');
        }

        if (!tlsjs.isValid(this.domain)) {
            return new SPFResult(results.None, 'No SPF record can be found on malformed domain');
        }
        // Parsed IP address.
        const addr = ipaddr.parse(ip);

        try {
            let mechanisms = await this.getMechanisms(addr.kind() === 'ipv4' ? 'A' : 'AAAA')
            return await this.evaluate(mechanisms, addr);
        } catch (err) {
            if (err instanceof SPFResult) {
                return err;
            }

            return new SPFResult(results.PermError, err.message);
        }
    }

    async evaluate(mechanisms, addr) {
        // TODO implement exp

        for (let i = 0; i < mechanisms.length; i++) {
            const mechanism = mechanisms[i];

            if (!this.options.prefetch && mechanism.resolve) {
                _.assign(mechanism, await mechanism.resolve());
            }

            if (mechanism.type === 'include') {
                mechanism.evaluated = await this.evaluate(mechanism.includes, addr);
            }

            if (this.match(mechanism, addr)) {
                const result = new SPFResult(mechanism.prefixdesc);

                result.mechanism = mechanism.type;
                result.matched = [mechanism.type];

                if (mechanism.type === 'include') {
                    result.matched = _.merge(result.matched, mechanism.evaluated.matched);
                }

                return result;
            }
        }

        // If none of the mechanisms match, then returns a result of "Neutral",
        // just as if "?all" were specified as the last directive.
        return new SPFResult(results.Neutral);
    }


    /**
     * Check if the instance domain includes requiredDomain in its SPF records
     * @param {string} requiredDomain domain to check it is included
     * @returns {Promise<SPFResult>}
     */
    async checkInclude(requiredDomain) {
        if (!tlsjs.isValid(this.domain)) {
            return new SPFResult(results.None, 'No SPF record can be found on malformed domain');
        }

        try {
            let mechanisms = await this.getMechanisms('A')
            return await this.evaluateInclude(mechanisms, requiredDomain);
        } catch (err) {
            if (err instanceof SPFResult) {
                return err;
            }

            return new SPFResult(results.PermError, err.message);
        }
    }

    /**
     * @private
     * @param mechanisms
     * @param domain
     * @param {any[]} [includeMechanisms=[]]
     * @returns {Promise<SPFResult>}
     */
    async evaluateInclude(mechanisms, domain, includeMechanisms) {
        if (!includeMechanisms) {
            includeMechanisms = [];
        }
        includeMechanisms.push(...mechanisms.filter(m => m.type === 'include'));
        if (includeMechanisms.length === 0) {
            return new SPFResult(results.Fail);
        }
        // loop first once to see if there is a direct match
        for (let i = 0; i < includeMechanisms.length; i++) {
            const mechanism = includeMechanisms[i];
            if (mechanism.value && mechanism.value.toLowerCase() === domain.toLowerCase()) {
                return new SPFResult(results.Pass);
            }
        }
        // then go over all the includes recursively in a BFS manner
        for (let i = 0; i < includeMechanisms.length; i++) {
            const mechanism = includeMechanisms[i];
            if (!this.options.prefetch && mechanism.resolve) {
                try {
                _.assign(mechanism, await mechanism.resolve());
                } catch (err) {
                    if (err instanceof SPFResult) {
                        if (err.result === results.None) {
                            continue;
                        }
                        throw err
                    }

                }
            }

            if (mechanism.type === 'include') {
                includeMechanisms = includeMechanisms.slice(i + 1)
                mechanism.evaluated = await this.evaluateInclude(mechanism.includes, domain, includeMechanisms);
            }

            if (mechanism.evaluated.result === results.None) {
                throw new SPFResult(results.PermError, 'Validation for "include:' + mechanism.value + '" missed');
            }

            if (this.match(mechanism)) {
                const result = new SPFResult(mechanism.prefixdesc);

                result.mechanism = mechanism.type;
                result.matched = [mechanism.type];

                if (mechanism.type === 'include') {
                    result.matched = _.merge(result.matched, mechanism.evaluated.matched);
                }

                return result;
            }
        }

        // If none of the mechanisms match, then returns a result of "Neutral",
        // just as if "?all" were specified as the last directive.
        return new SPFResult(results.Fail);
    }


    match(mechanism, addr) {
        switch (mechanism.type) {
            case 'version':
                if (mechanism.value !== 'spf' + this.options.version) {
                    throw new SPFResult(results.PermError, 'Version "' + mechanism.value + '" not supported');
                }
                return false;

            case 'a':
                return _.includes(mechanism.records, addr.toString());

            case 'mx':
                for (let i = 0; i < mechanism.exchanges.length; i++) {
                    if (_.includes(mechanism.exchanges[i].records, addr.toString())) {
                        return true;
                    }
                }
                return false;

            case 'ip4':
            case 'ip6':
                // The parsed CIDR is stored in `mechanism.address` as a tuple
                // with the IPv4/IPv6 instance as first element and the bits as
                // second.

                if (addr.kind() !== mechanism.address[0].kind()) {
                    return false;
                }

                return addr.match(mechanism.address);

            case 'include':
                if (mechanism.evaluated.result === results.None) {
                    throw new SPFResult(results.PermError, 'Validation for "include:' + mechanism.value + '" missed');
                }

                return mechanism.evaluated.result === results.Pass;

            // TODO implement ptr
            // TODO implement exists

            case 'all':
                return true;
        }

        throw new SPFResult(results.PermError, 'Mechanism "' + mechanism.type + '" not supported');
    }
}

module.exports = async function(ip, domain, sender, options) {
    let spf = new SPF(domain, sender, options);
    let res = await spf.check(ip);

    return res.result;
};

module.exports.SPFResults = results;
module.exports.SPF = SPF;
