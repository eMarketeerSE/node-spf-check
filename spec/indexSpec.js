'use strict';

const dns = require('dns');
const spf = require('../index');

describe('spf-check', () => {
    it('returns None when IP address is not valid', async () => {
        await expectAsync(spf('127.0.0.256', 'example.com')).toBeResolvedTo(spf.None);
    });

    it('returns None when hostname is not valid', async () => {
        await expectAsync(spf('127.0.0.1', '<invalid-hostname>')).toBeResolvedTo(spf.None);
    });

    it('returns TempError when dns.resolve fails', async () => {
        const resolve = spyOn(dns, 'resolve');
        await resolve.withArgs('example.com', 'TXT', jasmine.any(Function)).and.callFake((_0, _1, callback) => {
            callback(new Error('queryTxt ESERVFAIL example.com'));
        });

        await expectAsync(spf('127.0.0.1', 'example.com')).toBeResolvedTo(spf.TempError);

        expect(resolve).toHaveBeenCalledTimes(1);
    });

    it('returns TempError when dns.resolve fails recursively', async () => {
        const resolve = spyOn(dns, 'resolve');

        await resolve.withArgs('_1.example.com', 'TXT', jasmine.any(Function)).and.callFake((_0, _1, callback) => {
            callback(new Error('queryTxt ESERVFAIL example.com'));
        });

        await resolve.withArgs('_0.example.com', 'TXT', jasmine.any(Function)).and.callFake((_0, _1, callback) => {
            callback(null, [ [ 'v=spf1 ip4:192.168.0.1 -all' ] ]);
        });

        await resolve.withArgs('_spf.example.com', 'TXT', jasmine.any(Function)).and.callFake((_0, _1, callback) => {
            callback(null, [ [ 'v=spf1 include:_0.example.com', ' include:_1.example.com -all' ] ]);
        });

        await resolve.withArgs('example.com', 'TXT', jasmine.any(Function)).and.callFake((_0, _1, callback) => {
            callback(null, [ [ 'v=spf1 ', 'redirect=_spf.example.com' ] ]);
        });

        await expectAsync(spf('127.0.0.1', 'example.com')).toBeResolvedTo(spf.TempError);

        expect(resolve).toHaveBeenCalledTimes(4);
    });

    it('returns None when domain is not found', async () => {
        const resolve = spyOn(dns, 'resolve');
        await resolve.withArgs('example.com', 'TXT', jasmine.any(Function)).and.callFake((_0, _1, callback) => {
            callback(new Error('queryTxt ENOTFOUND example.com'));
        });

        await expectAsync(spf('127.0.0.1', 'example.com')).toBeResolvedTo(spf.None);

        expect(resolve).toHaveBeenCalledTimes(1);
    });

    it('returns None when no TXT records are found', async () => {
        const resolve = spyOn(dns, 'resolve');
        await resolve.withArgs('example.com', 'TXT', jasmine.any(Function)).and.callFake((_0, _1, callback) => {
            callback(null, []);
        });

        await expectAsync(spf('127.0.0.1', 'example.com')).toBeResolvedTo(spf.None);

        expect(resolve).toHaveBeenCalledTimes(1);
    });

    it('returns PermError when more than one TXT record is found', async () => {
        const resolve = spyOn(dns, 'resolve');
        await resolve.withArgs('example.com', 'TXT', jasmine.any(Function)).and.callFake((_0, _1, callback) => {
            callback(null, [ [ 'v=spf1 ', 'redirect=_spf.example.com' ], [ 'v=spf1 ip4:192.168.0.1/32 -all' ] ]);
        });

        await expectAsync(spf('127.0.0.1', 'example.com')).toBeResolvedTo(spf.PermError);

        expect(resolve).toHaveBeenCalledTimes(1);
    });

    it('returns PermError when TXT is not in US-ASCII', async () => {
        const resolve = spyOn(dns, 'resolve');
        await resolve.withArgs('example.com', 'TXT', jasmine.any(Function)).and.callFake((_0, _1, callback) => {
            callback(null, [ [ 'v=spf1 ', '' ] ]);
        });

        await expectAsync(spf('127.0.0.1', 'example.com')).toBeResolvedTo(spf.PermError);

        expect(resolve).toHaveBeenCalledTimes(1);
    });

    it('returns PermError when TXT record contains syntax errors', async () => {
        const resolve = spyOn(dns, 'resolve');
        await resolve.withArgs('example.com', 'TXT', jasmine.any(Function)).and.callFake((_0, _1, callback) => {
            callback(null, [ [ 'v=spf1 ip12:12.12.12.12/24 -none' ] ]);
        });

        await expectAsync(spf('127.0.0.1', 'example.com')).toBeResolvedTo(spf.PermError);

        expect(resolve).toHaveBeenCalledTimes(1);
    });

    it('returns PermError when DNS query limit is reached', async () => {
        const resolve = spyOn(dns, 'resolve');

        // This one will never be called because it will fail before.
        //await resolve.withArgs('local.example.com', 'A', jasmine.any(Function)).and.callFake((_0, _1, callback) => {
        //    callback(null, [ '127.0.0.1' ]);
        //});

        await resolve.withArgs('srv.example.com', 'A', jasmine.any(Function)).and.callFake((_0, _1, callback) => {
            callback(null, [ '192.168.0.10' ]);
        });

        await resolve.withArgs('pop.example.com', 'A', jasmine.any(Function)).and.callFake((_0, _1, callback) => {
            callback(null, [ '192.168.0.9' ]);
        });

        await resolve.withArgs('smtp.example.com', 'A', jasmine.any(Function)).and.callFake((_0, _1, callback) => {
            callback(null, [ '192.168.0.8' ]);
        });

        await resolve.withArgs('_1.example.com', 'A', jasmine.any(Function)).and.callFake((_0, _1, callback) => {
            callback(null, [ '192.168.0.2' ]);
        });

        await resolve.withArgs('_1.example.com', 'TXT', jasmine.any(Function)).and.callFake((_0, _1, callback) => {
            callback(null, [ [ 'v=spf1 a a:smtp.example.com', ' a:pop.example.com a:srv.example.com ', 'a:local.example.com -all' ] ]);
        });

        await resolve.withArgs('imap.example.com', 'A', jasmine.any(Function)).and.callFake((_0, _1, callback) => {
            callback(null, [ '192.168.0.7' ]);
        });

        await resolve.withArgs('_0.example.com', 'A', jasmine.any(Function)).and.callFake((_0, _1, callback) => {
            callback(null, [ '192.168.0.1' ]);
        });

        // This will not count for mechanisms limit but needs a return value if
        // not spyOn will swallow it.
        await resolve.withArgs('mx.example.com', 'A', jasmine.any(Function)).and.callFake((_0, _1, callback) => {
            callback(null, [ '192.168.0.42' ]);
        });

        await resolve.withArgs('example.com', 'MX', jasmine.any(Function)).and.callFake((_0, _1, callback) => {
            callback(null, [ { priority: 10, exchange: 'mx.example.com' } ]);
        });

        await resolve.withArgs('_0.example.com', 'TXT', jasmine.any(Function)).and.callFake((_0, _1, callback) => {
            callback(null, [ [ 'v=spf1 mx:example.com a a:imap.example.com -all' ] ]);
        });

        await resolve.withArgs('_spf.example.com', 'TXT', jasmine.any(Function)).and.callFake((_0, _1, callback) => {
            callback(null, [ [ 'v=spf1 include:_0.example.com', ' include:_1.example.com -all' ] ]);
        });

        await resolve.withArgs('example.com', 'TXT', jasmine.any(Function)).and.callFake((_0, _1, callback) => {
            callback(null, [ [ 'v=spf1 ', 'redirect=_spf.example.com' ] ]);
        });

        await expectAsync(spf('127.0.0.1', 'example.com')).toBeResolvedTo(spf.PermError);

        // This are 10 calls for each mechanism and one call for the A records
        // of the MX exchange.
        expect(resolve).toHaveBeenCalledTimes(11);
    });

    it('returns PermError when DNS lookups for MX mechanism exeeds limit', async () => {
        const resolve = spyOn(dns, 'resolve');

        await resolve.withArgs('example.com', 'MX', jasmine.any(Function)).and.callFake((_0, _1, callback) => {
            callback(null, [
                { priority: 5, exchange: 'mx0.example.com' },
                { priority: 10, exchange: 'mx1.example.com' },
                { priority: 20, exchange: 'mx2.example.com' },
                { priority: 30, exchange: 'mx3.example.com' },
                { priority: 40, exchange: 'mx4.example.com' },
                { priority: 50, exchange: 'mx5.example.com' },
                { priority: 60, exchange: 'mx6.example.com' },
                { priority: 70, exchange: 'mx7.example.com' },
                { priority: 80, exchange: 'mx8.example.com' },
                { priority: 90, exchange: 'mx9.example.com' },
            ]);
        });

        await resolve.withArgs('example.com', 'TXT', jasmine.any(Function)).and.callFake((_0, _1, callback) => {
            callback(null, [ [ 'v=spf1 ', 'mx +all' ] ]);
        });

        await expectAsync(spf('127.0.0.1', 'example.com')).toBeResolvedTo(spf.PermError);

        expect(resolve).toHaveBeenCalledTimes(2);
    });

    it('returns Neutral when no mechanism is matched', async () => {
        const resolve = spyOn(dns, 'resolve');

        await resolve.withArgs('example.com', 'TXT', jasmine.any(Function)).and.callFake((_0, _1, callback) => {
            callback(null, [ [ 'v=spf1 a' ] ]);
        });

        await resolve.withArgs('example.com', 'A', jasmine.any(Function)).and.callFake((_0, _1, callback) => {
            callback(null, [ '192.168.0.7' ]);
        });

        await expectAsync(spf('127.0.0.1', 'example.com')).toBeResolvedTo(spf.Neutral);

        expect(resolve).toHaveBeenCalledTimes(2);
    });

    it('returns Pass when A mechanism match', async () => {
        const resolve = spyOn(dns, 'resolve');

        await resolve.withArgs('example.com', 'TXT', jasmine.any(Function)).and.callFake((_0, _1, callback) => {
            callback(null, [ [ 'v=spf1 a' ] ]);
        });

        await resolve.withArgs('example.com', 'A', jasmine.any(Function)).and.callFake((_0, _1, callback) => {
            callback(null, [ '127.0.0.1' ]);
        });

        await expectAsync(spf('127.0.0.1', 'example.com')).toBeResolvedTo(spf.Pass);

        expect(resolve).toHaveBeenCalledTimes(2);
    });

    it('returns Pass when MX mechanism match', async () => {
        const resolve = spyOn(dns, 'resolve');

        await resolve.withArgs('example.com', 'TXT', jasmine.any(Function)).and.callFake((_0, _1, callback) => {
            callback(null, [ [ 'v=spf1 mx' ] ]);
        });

        await resolve.withArgs('example.com', 'MX', jasmine.any(Function)).and.callFake((_0, _1, callback) => {
            callback(null, [ { priority: 10, exchange: 'mx.example.com' } ]);
        });

        await resolve.withArgs('mx.example.com', 'A', jasmine.any(Function)).and.callFake((_0, _1, callback) => {
            callback(null, [ '127.0.0.1' ]);
        });

        await expectAsync(spf('127.0.0.1', 'example.com')).toBeResolvedTo(spf.Pass);

        expect(resolve).toHaveBeenCalledTimes(3);
    });

    it('returns Pass when IP4 mechanism match', async () => {
        const resolve = spyOn(dns, 'resolve');
        await resolve.withArgs('example.com', 'TXT', jasmine.any(Function)).and.callFake((_0, _1, callback) => {
            callback(null, [ [ 'v=spf1 ip4:127.0.0.1' ] ]);
        });

        await expectAsync(spf('127.0.0.1', 'example.com')).toBeResolvedTo(spf.Pass);

        expect(resolve).toHaveBeenCalledTimes(1);
    });

    it('returns Pass when IP6 mechanism match', async () => {
        const resolve = spyOn(dns, 'resolve');
        await resolve.withArgs('example.com', 'TXT', jasmine.any(Function)).and.callFake((_0, _1, callback) => {
            callback(null, [ [ 'v=spf1 ip6:2001:DB8::CB01' ] ]);
        });

        await expectAsync(spf('2001:DB8::CB01', 'example.com')).toBeResolvedTo(spf.Pass);

        expect(resolve).toHaveBeenCalledTimes(1);
    });

    it('returns Pass when INCLUDE mechanism is resolved and match', async () => {
        const resolve = spyOn(dns, 'resolve');

        await resolve.withArgs('example.com', 'TXT', jasmine.any(Function)).and.callFake((_0, _1, callback) => {
            callback(null, [ [ 'v=spf1 include:_spf.example.com' ] ]);
        });

        await resolve.withArgs('_spf.example.com', 'TXT', jasmine.any(Function)).and.callFake((_0, _1, callback) => {
            callback(null, [ [ 'v=spf1 +all' ] ]);
        });

        await expectAsync(spf('127.0.0.1', 'example.com')).toBeResolvedTo(spf.Pass);

        expect(resolve).toHaveBeenCalledTimes(2);
    });

    it('returns Pass when INCLUDE mechanism is resolved and match expected include', async () => {
        const resolve = spyOn(dns, 'resolve');

        await resolve.withArgs('example.com', 'TXT', jasmine.any(Function)).and.callFake((_0, _1, callback) => {
            callback(null, [['v=spf1 include:_spf.example.com']]);
        });

        await resolve.withArgs('_spf.example.com', 'TXT', jasmine.any(Function)).and.callFake((_0, _1, callback) => {
            callback(null, [['v=spf1 +all']]);
        });

        await expectAsync(spf('127.0.0.1', 'example.com')).toBeResolvedTo(spf.Pass);

        expect(resolve).toHaveBeenCalledTimes(2);
    });

    it('returns Pass when INCLUDE mechanism is resolved and match expected include', async () => {
        const resolve = spyOn(dns, 'resolve');

        await resolve.withArgs('example.com', 'TXT', jasmine.any(Function)).and.callFake((_0, _1, callback) => {
            callback(null, [['v=spf1 include:_spf1.example.com']]);
        });

        await resolve.withArgs('_spf1.example.com', 'TXT', jasmine.any(Function)).and.callFake((_0, _1, callback) => {
            callback(null, [['v=spf1 include:_spf2.example.com']]);
        });

        await resolve.withArgs('_spf2.example.com', 'TXT', jasmine.any(Function)).and.callFake((_0, _1, callback) => {
            callback(null, [ [ 'v=spf1 ip4:127.0.0.1' ] ]);
        });

        let s = new spf.SPF('example.com');
        await expectAsync(s.checkInclude('_spf1.example.com')).toBeResolvedTo(jasmine.objectContaining({result: spf.Pass}));

        expect(resolve).toHaveBeenCalledTimes(1);
        resolve.calls.reset()

        await expectAsync(s.checkInclude('_spf2.example.com')).toBeResolvedTo(jasmine.objectContaining({result: spf.Pass}));

        expect(resolve).toHaveBeenCalledTimes(2);

        await expectAsync(s.checkInclude('_spf3.example.com')).toBeResolvedTo(jasmine.objectContaining({result: spf.Fail}));
    });
});
