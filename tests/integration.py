"""Real backend integration. Run on the host with the service running; ~2 minutes."""
import urllib.request, urllib.error, json, time, pathlib, sys
BASE='http://127.0.0.1:8000'
def api(path,data=None):
    req=urllib.request.Request(BASE+path,data=json.dumps(data).encode() if data is not None else None,headers={'Content-Type':'application/json','X-CN-Sim':'1'})
    try:
        with urllib.request.urlopen(req,timeout=30)as r:return json.load(r)
    except urllib.error.HTTPError as e:raise RuntimeError(e.read().decode())
def wait():
    end=time.monotonic()+300;last=None
    while time.monotonic()<end:
        s=api('/api/state')
        if s['phase']!=last:print(s['phase'],s['message'],flush=True);last=s['phase']
        if not s['busy']:
            if s['error']:raise RuntimeError(s['error'])
            return s
        time.sleep(1)
    raise RuntimeError('Integration timeout')
if __name__=='__main__':
    top=json.loads(pathlib.Path('dist/examples/redundant.json').read_text());existing={r['id']for r in api('/api/state')['results']}
    api('/api/experiments',dict(topology=top,protocols=['RIP','OSPF','EIGRP'],source='PC1',target='PC2',duration=12,rate=20,size=512,trials=1,failure_link='L3',failure_at=5,timer_profile='lab'))
    s=wait();results=[api('/api/results/'+r['id'])for r in s['results']if r['id']not in existing]
    assert len(results)==3,results
    for r in results:
        m=r['metrics'];print(r['protocol'],json.dumps(m),flush=True)
        assert m['sent']==240,(r['protocol'],'send count',m)
        assert m['delivered']>100,(r['protocol'],'delivery',m)
        assert m['controlBytes']>0,(r['protocol'],'control capture',m)
        assert any(p['hops']for p in r['packets']),(r['protocol'],'no packet captures')
        assert r['failureAt'] is not None
    probe=api('/api/probe',dict(source='PC1',target='PC2',kind='ping'));print(probe['output'],flush=True)
    assert ', 0% packet loss' in probe['output'],probe
    pathlib.Path('artifacts').mkdir(exist_ok=True);pathlib.Path('artifacts/integration-summary.json').write_text(json.dumps([dict(protocol=r['protocol'],metrics=r['metrics'])for r in results],indent=2))
    print('PASS: all real protocol experiments, capture correlation, failure injection and post-failure forwarding',flush=True)
