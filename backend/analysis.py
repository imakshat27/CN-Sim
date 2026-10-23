import statistics, math

def summarize(sent,received,captures,duration,start_epoch,start_ns,rate,size,failure_time,route_samples,initial_convergence,initial_ready):
    tx={p['id']:p for p in sent if 'id'in p};rx={p['id']:p for p in received if 'id'in p and p['id']in tx};acks={p['ack']:p['rtt_ms'] for p in sent if 'ack'in p}
    packets=[]
    cap_by_id={}
    for e in captures:
        if e.get('protocol')=='PROBE' and e.get('direction')=='request':cap_by_id.setdefault(e['id'],[]).append(e)
    for id,p in tx.items():
        r=rx.get(id);delay=(r['received_ns']-p['sent_ns'])/1e6 if r else None
        hops=[{'node':e['node'],'interface':e.get('interface'),'time':round(e['epoch']-start_epoch,6),'ip_bytes':e['bytes']} for e in sorted(cap_by_id.get(id,[]),key=lambda x:x['epoch'])]
        packets.append({'id':id,'time':(p['sent_ns']-start_ns)/1e9,'status':'delivered' if r else 'lost','delay':delay,'rtt':acks.get(id),'bytes':p['bytes'],'error':p.get('error'),'hops':hops})
    packets.sort(key=lambda p:p['id']);ds=[p['delay'] for p in packets if p['delay'] is not None];j=[abs(ds[i]-ds[i-1]) for i in range(1,len(ds))]
    control=[e for e in captures if e['protocol']in ('RIP','OSPF','EIGRP') and start_epoch<=e['epoch']<start_epoch+duration]
    startup=[e for e in captures if e['protocol']in ('RIP','OSPF','EIGRP') and e['epoch']<start_epoch]
    recovery=None;route_convergence=None
    if failure_time is not None:
        # A routing table must remain unchanged and complete for 2 s. Resolution is the sample period.
        after=[s for s in route_samples if s['time']>=failure_time]
        if after:
            final=after[-1];last=after[0]['time']
            for i,s in enumerate(after):
                if i==0 or s['signature']!=after[i-1]['signature']:last=s['time']
            if final['complete'] and final['time']-last>=2:route_convergence=max(0,last-failure_time)
        post=[p for p in packets if p['time']>=failure_time]
        # First continuous 1-second window with all expected packets delivered; excludes partial trailing windows.
        for i,p in enumerate(post):
            window=post[i:i+rate]
            if len(window)==rate and window[-1]['time']-p['time']>=.8 and all(x['status']=='delivered' for x in window):recovery=max(0,p['time']-failure_time);break
    ds_sorted=sorted(ds)
    metrics={'sent':len(tx),'delivered':len(rx),'lost':len(tx)-len(rx),'delivery':100*len(rx)/len(tx) if tx else 0,'loss':100*(len(tx)-len(rx))/len(tx) if tx else 0,'meanDelay':statistics.mean(ds) if ds else None,'p95Delay':ds_sorted[max(0,math.ceil(len(ds)*.95)-1)] if ds else None,'jitter':statistics.mean(j) if j else None,'meanRTT':statistics.mean(acks.values()) if acks else None,'throughput':len(rx)*size*8/max(duration,.001)/1e6,'offeredLoad':len(tx)*size*8/max(duration,.001)/1e6,'controlBytes':sum(e['bytes'] for e in control),'controlMessages':len(control),'dataBytes':sum(e['bytes'] for e in captures if e['protocol']=='PROBE' and start_epoch<=e['epoch']<start_epoch+duration),'startupControlBytes':sum(e['bytes'] for e in startup),'initialConvergence':initial_convergence if initial_ready else None,'recovery':recovery,'routeConvergence':route_convergence,'duration':duration,'routeChanges':sum(s['changed'] for s in route_samples),'samplingInterval':.5}
    bins=[]
    for i in range(math.ceil(duration)):
        ps=[p for p in packets if i<=p['time']<i+1];delivered=[p for p in ps if p['status']=='delivered'];span=min(1,duration-i)
        bins.append({'time':i,'sent':len(ps),'delivered':len(delivered),'loss':len(ps)-len(delivered),'throughput':len(delivered)*size*8/max(span,.001)/1e6,'delay':statistics.mean(p['delay'] for p in delivered) if delivered else None,'controlBytes':sum(e['bytes'] for e in control if i<=e['epoch']-start_epoch<i+1)})
    return metrics,packets,bins,control

def score(metrics,failure):
    m=metrics;conv=m['routeConvergence'] if failure else m['initialConvergence'];payload=m['delivered']
    delivery=m['delivery'];latency=100/(1+m['meanDelay']/50) if m['meanDelay'] is not None else 0;convergence=100/(1+conv/2) if conv is not None else 0
    return {'delivery':delivery,'latency':latency,'convergence':convergence}

def aggregate(results):
    summary=[]
    for protocol in ['RIP','OSPF','EIGRP']:
        runs=[r for r in results if r['protocol']==protocol and r['status']=='completed']
        if not runs:continue
        values={}
        for key in runs[0]['metrics']:
            xs=[r['metrics'][key] for r in runs if isinstance(r['metrics'].get(key),(int,float))]
            values[key]={'mean':statistics.mean(xs),'std':statistics.stdev(xs) if len(xs)>1 else 0,'n':len(xs)} if xs else {'mean':None,'std':None,'n':0}
        summary.append({'protocol':protocol,'trials':len(runs),'metrics':values})
    return summary
