declare namespace _exports {
    export { ResultEnum, SPFOptions };
}
declare function _exports(ip: any, domain: any, sender: any, options: any): Promise<"None" | "Neutral" | "Pass" | "Fail" | "SoftFail" | "TempError" | "PermError">;
declare namespace _exports {
    export { results as SPFResults };
    export { SPF };
}
export = _exports;
type ResultEnum = {
    /**
     * "None"
     */
    None: string;
    /**
     * "Neutral"
     */
    Neutral: string;
    /**
     * "Pass"
     */
    Pass: string;
    /**
     * "Fail"
     */
    Fail: string;
    /**
     * "SoftFail"
     */
    SoftFail: string;
    /**
     * "TempError"
     */
    TempError: string;
    /**
     * "PermError"
     */
    PermError: string;
};
type SPFOptions = {
    /**
     * - SPF version, conforms to https://tools.ietf.org/html/rfc4408
     */
    version?: number;
    /**
     * - Resolve all mechanisms before evaluating them.
     * This will cause many DNS queries to be made and possible hit the 10 queries hard limit.
     * Note that "redirect" mechanisms always resolve first no matter the value of this option.
     */
    prefetch?: boolean;
    /**
     * - Hard limit on the number of DNS lookups, including any lookups
     * caused by the use of the "include" mechanism or the "redirect" modifier.
     */
    maxDNS?: number;
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
declare const results: ResultEnum;
/**
 * @typedef {Object} SPFOptions
 * @property {number} [version=1] - SPF version, conforms to https://tools.ietf.org/html/rfc4408
 * @property {boolean} [prefetch=false] - Resolve all mechanisms before evaluating them.
 * This will cause many DNS queries to be made and possible hit the 10 queries hard limit.
 * Note that "redirect" mechanisms always resolve first no matter the value of this option.
 * @property {number} [maxDNS=10] - Hard limit on the number of DNS lookups, including any lookups
 * caused by the use of the "include" mechanism or the "redirect" modifier.
 */
declare class SPF {
    /**
     * @param {string} domain - Domain to check.
     * @param {string} [sender] - Sender email address.
     * @param {SPFOptions} [options]
     */
    constructor(domain: string, sender?: string, options?: SPFOptions);
    domain: any;
    sender: any;
    warnings: any[];
    queryDNSCount: number;
    options: {
        /**
         * - SPF version, conforms to https://tools.ietf.org/html/rfc4408
         */
        version: number;
        /**
         * - Resolve all mechanisms before evaluating them.
         * This will cause many DNS queries to be made and possible hit the 10 queries hard limit.
         * Note that "redirect" mechanisms always resolve first no matter the value of this option.
         */
        prefetch: boolean;
        /**
         * - Hard limit on the number of DNS lookups, including any lookups
         * caused by the use of the "include" mechanism or the "redirect" modifier.
         */
        maxDNS: number;
    };
    resolveMX(hostname: any, rrtype: any): Promise<any>;
    resolveDNS(hostname: any, rrtype: any, lookupLimit: any): Promise<any>;
    resolveSPF(hostname: any, rrtype: any): any;
    getMechanisms(rrtype: any): Promise<any>;
    check(ip: any): Promise<SPFResult>;
    evaluate(mechanisms: any, addr: any): Promise<SPFResult>;
    /**
     * Check if the instance domain includes requiredDomain in its SPF records
     * @param {string} requiredDomain domain to check it is included
     * @returns {Promise<SPFResult>}
     */
    checkInclude(requiredDomain: string): Promise<SPFResult>;
    /**
     * @private
     * @param mechanisms
     * @param domain
     * @param {any[]} [includeMechanisms=[]]
     * @returns {Promise<SPFResult>}
     */
    private evaluateInclude;
    match(mechanism: any, addr: any): any;
}
declare class SPFResult {
    /**
     * @property {string} result - An string value of results constant. available values: None, Neutral, Pass, Fail, SoftFail, TempError, PermError.
     * @property {string} message - Description text.
     */
    constructor(result: any, message: any);
    /**
     * @type {"None"|"Neutral"|"Pass"|"Fail"|"SoftFail"|"TempError"|"PermError"}
     * @public
     */
    public result: "None" | "Neutral" | "Pass" | "Fail" | "SoftFail" | "TempError" | "PermError";
    /**
     * @type {string}
     * @public
     */
    public message: string;
    /** Last matched mechanism or "default" if none. Used in Received-SPF
     *  header field. */
    mechanism: string;
    /** List of all matched mechanisms (order from last to first). */
    matched: any[];
}
//# sourceMappingURL=index.d.ts.map