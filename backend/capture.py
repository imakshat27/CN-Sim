"""Read tcpdump's classic PCAP, Linux cooked v1/v2, Ethernet and raw IPv4."""
import struct
from pathlib import Path

def read_capture(path,node,interfaces):
    result=[]
    try:f=open(path,'rb')
    except OSError:return result
    with f:
        head=f.read(24)
        if len(head)!=24:return result
        magic=head[:4]
        endian='<' if magic in (b'\xd4\xc3\xb2\xa1',b'\x4d\x3c\xb2\xa1') else '>'
        nanos=magic in (b'\x4d\x3c\xb2\xa1',b'\xa1\xb2\x3c\x4d')
        linktype=struct.unpack(endian+'I',head[20:24])[0]
        while True:
            rh=f.read(16)
            if len(rh)!=16:break
            sec,frac,cap,orig=struct.unpack(endian+'IIII',rh)
            if cap>65536:break
            data=f.read(cap)
            if len(data)<cap:break
            iface=None
            if linktype==276:
                if len(data)<20:continue
                if struct.unpack('!H',data[:2])[0]!=0x0800:continue
                iface=interfaces.get(struct.unpack('!I',data[4:8])[0]);offset=20
            elif linktype==113:
                if len(data)<16 or struct.unpack('!H',data[14:16])[0]!=0x0800:continue
                offset=16
            elif linktype==1:
                if len(data)<14 or data[12:14]!=b'\x08\x00':continue
                offset=14
            elif linktype in (101,228):offset=0
            else:continue
            ip=data[offset:]
            if len(ip)<20 or ip[0]>>4!=4:continue
            ihl=(ip[0]&15)*4;proto=ip[9];size=int.from_bytes(ip[2:4],'big')
            src='.'.join(str(x) for x in ip[12:16]);dst='.'.join(str(x) for x in ip[16:20]);payload=ip[ihl:]
            record={'epoch':sec+frac/(1e9 if nanos else 1e6),'node':node,'interface':iface,'bytes':size,'source':src,'target':dst,'protocol':{89:'OSPF',88:'EIGRP'}.get(proto,'UDP')}
            if proto==17:
                if len(payload)<8:continue
                sp,dp=struct.unpack('!HH',payload[:4]);record.update(source_port=sp,target_port=dp)
                if sp==520 or dp==520:record['protocol']='RIP'
                elif len(payload)>=24 and payload[8:12]==b'CNSM':
                    record.update(protocol='PROBE',id=int.from_bytes(payload[12:16],'big'),direction='request' if dp==49000 else 'echo')
                else:continue
            elif proto not in (88,89):continue
            # An egress is counted once at each link transmission, never at ingress.
            if linktype==276 and iface is None:continue
            result.append(record)
    return result
