"""Feasibility check: a learned remote route and real ping for each FRR daemon."""
import subprocess as sp, pathlib, time, json

def run(*args,check=True):
    p=sp.run(args,text=True,stdout=sp.PIPE,stderr=sp.STDOUT)
    if check and p.returncode: raise RuntimeError(f'{args}: {p.stdout}')
    return p.stdout

processes=[]
try:
    for i in range(1,4):
        ns=f'proof{i}'
        run('ip','netns','add',ns)
        run('ip','-n',ns,'link','set','lo','up')
        run('ip','-n',ns,'addr','add',f'10.255.0.{i}/32','dev','lo')
        run('ip','netns','exec',ns,'sysctl','-qw','net.ipv4.ip_forward=1')
        for iface in ['all','default','lo']:run('ip','netns','exec',ns,'sysctl','-qw',f'net.ipv4.conf.{iface}.rp_filter=0')
    for i in range(1,3):
        a,b=f'p{i}a',f'p{i}b'
        run('ip','link','add',a,'type','veth','peer','name',b)
        for name,node,addr in [(a,i,1),(b,i+1,2)]:
            ns=f'proof{node}'
            run('ip','link','set',name,'netns',ns)
            run('ip','-n',ns,'addr','add',f'10.0.{i}.{addr}/30','dev',name)
            run('ip','-n',ns,'link','set',name,'up')
    for protocol,daemon,commands in [('RIP','ripd','router rip\n version 2\n network 10.0.0.0/8\n redistribute connected\n'),('OSPF','ospfd','router ospf\n network 10.0.0.0/8 area 0\n'),('EIGRP','eigrpd','router eigrp 100\n network 10.0.0.0/8\n')]:
        for i in range(1,4):
            ns=f'proof{i}';root=pathlib.Path('/run/frr')/ns;root.mkdir(parents=True,exist_ok=True);root.chmod(0o777)
            ifaces={1:['p1a'],2:['p1b','p2a'],3:['p2b']}[i]
            base=f'hostname {ns}\nlog stdout\n'
            cfg=base
            if protocol=='OSPF':
                for iface in ifaces:cfg+=f'interface {iface}\n ip ospf network point-to-point\n ip ospf hello-interval 1\n ip ospf dead-interval 4\n!\n'
            cfg+=commands
            if protocol=='EIGRP':
                for iface in ifaces:cfg+=f' no passive-interface {iface}\n'
            for d,content in [('zebra',base),(daemon,cfg)]:
                config=root/f'{d}.conf';config.write_text(content)
                out=open(root/f'{d}.log','w')
                p=sp.Popen(['ip','netns','exec',ns,f'/usr/lib/frr/{d}','-f',str(config),'-i',str(root/f'{d}.pid'),'-z',str(root/'zserv.api'),'--vty_socket',str(root),'-A','127.0.0.1','-u','frr','-g','frr'],stdout=out,stderr=sp.STDOUT);processes.append(p)
                if d=='zebra':time.sleep(.25)
        start=time.monotonic();ok=False;routes=''
        while time.monotonic()-start<45:
            routes=run('vtysh','--vty_socket','/run/frr/proof1','-c','show ip route',check=False)
            if f'{"R" if protocol=="RIP" else "O" if protocol=="OSPF" else "E"}>* 10.255.0.3/32' in routes:
                ping=run('ip','netns','exec','proof1','ping','-I','10.255.0.1','-c','2','-W','2','10.255.0.3',check=False)
                ok='0% packet loss' in ping and '100% packet loss' not in ping
                if ok:break
            time.sleep(1)
        print(json.dumps({'protocol':protocol,'passed':ok,'seconds':round(time.monotonic()-start,2),'routes':routes}),flush=True)
        if not ok:
            for i in range(1,4):
                for d in ['zebra',daemon]:print(f'{i}/{d}:',pathlib.Path(f'/run/frr/proof{i}/{d}.log').read_text(),flush=True)
        for p in reversed(processes):p.terminate()
        for p in processes:
            try:p.wait(timeout=3)
            except sp.TimeoutExpired:p.kill();p.wait()
        processes=[]
        for i in range(1,4):
            for path in pathlib.Path(f'/run/frr/proof{i}').glob('*.vty'):path.unlink(missing_ok=True)
            pathlib.Path(f'/run/frr/proof{i}/zserv.api').unlink(missing_ok=True)
        if not ok:raise RuntimeError(protocol+' failed feasibility check')
finally:
    for p in processes:p.kill()
    for i in range(1,4):run('ip','netns','del',f'proof{i}',check=False)
