import assert from 'node:assert/strict';
export async function verifyResearch(call, setFetch) {
  const sender='0x'+'1'.repeat(40), recipient='0x'+'2'.repeat(40), collection='0x'+'3'.repeat(40), other='0x'+'4'.repeat(40);
  const tx='0x'+'5'.repeat(64), block='0x'+'6'.repeat(64);
  const event = (n, extra={}) => ({ from:{hash:sender,metadata:{tags:[{image:'data:image/svg+xml;'+'x'.repeat(100000)}]}},to:{hash:recipient},
    token:{address_hash:collection,type:'ERC-721',exchange_rate:'999'},token_type:'ERC-721',total:{token_id:String(n)},
    transaction_hash:tx,log_index:n,block_number:123,block_hash:block,timestamp:'2026-01-01T00:00:00Z',...extra });
  // Synthetic ENS -> candidate collection -> outgoing history; no Milady-specific logic.
  setFetch(async (_url, options) => {
    const requests=JSON.parse(options.body);
    const respond=q=>{
      assert.equal(q.method,'eth_call');
      const word=v=>v.padStart(64,'0');
      const result='0x'+word('40')+word(other.slice(2))+word('20')+word(sender.slice(2));
      return {jsonrpc:'2.0',id:q.id,result};
    };
    return new Response(JSON.stringify(Array.isArray(requests)?requests.map(respond):respond(requests)));
  });
  assert.equal((await call('resolveENS',{name:'synthetic.eth'})).toLowerCase(),sender);
  setFetch(async url=>{ assert.ok(String(url).includes('/search?q=Synthetic'));
    return new Response(JSON.stringify({items:[{address_hash:collection,name:'Synthetic collection',type:'token',token_type:'ERC-721'}],next_page_params:null})); });
  assert.equal((await call('getBlockscoutSearch',{chain:1,query:'Synthetic collection'})).items[0].address_hash,collection);
  const args={chain:'1',address:sender,collection,direction:'outgoing',limit:1};
  const first=[event(1),event(1),event(2,{from:{hash:recipient},to:{hash:sender}}),event(3,{token:{address_hash:other}}),event(4)];
  const second=[event(4),event(5,{token_type:'ERC-1155',total:{token_id:'900719925474099312345',value:'9007199254740993'},index_in_batch:0}),
    event(5,{token_type:'ERC-1155',total:{token_id:'900719925474099312345',value:'2'},index_in_batch:1})];
  let urls=[];
  setFetch(async url => { urls.push(String(url)); const u=new URL(url); assert.equal(u.hostname,'eth.blockscout.com');
    assert.equal(u.searchParams.has('page'),false); assert.equal(u.searchParams.has('offset'),false);
    return new Response(JSON.stringify(u.searchParams.has('block_number') ? {items:second,next_page_params:null} : {items:first,next_page_params:{block_number:122,index:4}})); });
  let all=[], continuation, terminal;
  for(let i=0;i<10;i++) { const r=await call('getAddressTokenTransfers',{...args,continuation});
    assert.equal(r.schemaVersion,1); assert.equal(r.network.chainId,'1');
    assert.ok(JSON.stringify(r).length<64000); assert.ok(!JSON.stringify(r).includes('data:image')); assert.ok(!JSON.stringify(r).includes('exchange_rate'));
    all.push(...r.items); continuation=r.continuation; terminal=r; if(!continuation) break; }
  assert.equal(terminal.coverage.endpointExhausted,true);
  assert.equal(all.length,5); // replay skip removes the within-page duplicate; cross-page overlap remains inspectable.
  assert.equal(all[3].quantity,'9007199254740993'); assert.equal(all[3].tokenId,'900719925474099312345');
  assert.notEqual(all[3].batchIndex,all[4].batchIndex);
  assert.ok(urls.some(u=>u.includes('block_number=122')));
  const recipients=await call('getNFTTransferRecipients',{chain:'1',address:sender,collection});
  assert.equal(recipients.events.length,4); assert.deepEqual(recipients.recipients,[recipient]);
  assert.equal(recipients.coverage.allRecipientsEstablished,true);
  // Incoming sender/recipient filtering is independent of collection.
  const incoming=await call('getAddressTokenTransfers',{...args,direction:'incoming',limit:20});
  assert.equal(incoming.items.length,1); assert.equal(incoming.items[0].sender,recipient);
  setFetch(async()=>new Response(JSON.stringify({items:[],next_page_params:null})));
  const empty=await call('getNFTTransferRecipients',{chain:1,address:sender,collection});
  assert.equal(empty.events.length,0); assert.equal(empty.coverage.allRecipientsEstablished,true);
  setFetch(async()=>new Response(JSON.stringify({items:[event(1)],next_page_params:{block_number:122,index:4}})));
  const repeated=await call('getNFTTransferRecipients',{chain:1,address:sender,collection});
  assert.equal(repeated.coverage.allRecipientsEstablished,false);
  assert.equal(repeated.events.length,1);
  setFetch(async()=>new Response(JSON.stringify({items:[event(1,{from:null})],next_page_params:null})));
  const unknown=await call('getNFTTransferRecipients',{chain:1,address:sender,collection});
  assert.equal(unknown.coverage.allRecipientsEstablished,false); assert.equal(unknown.coverage.unknownRecords,1);
  for(const data of [{items:[]},{items:'invalid'},'not json']) {
    setFetch(async()=>new Response(typeof data==='string'?data:JSON.stringify(data)));
    if(typeof data==='object' && Array.isArray(data.items)) {
      const incomplete=await call('getAddressTokenTransfers',args); assert.equal(incomplete.coverage.endpointExhausted,false);
    } else await assert.rejects(()=>call('getAddressTokenTransfers',args));
  }
  setFetch(async()=>{ const e=new Error('simulated timeout');e.name='TimeoutError';throw e; });
  await assert.rejects(()=>call('getSmartContracts',{chain:'1',q:'Synthetic collection'}));
  setFetch(async()=>new Response('secret-api-key upstream private body',{status:503}));
  await assert.rejects(()=>call('getSmartContracts',{chain:'1',q:'Synthetic collection'}), e=>!String(e).includes('secret'));
  // Partial scan keeps successful evidence when the following page fails.
  setFetch(async url=>String(url).includes('?') ? new Response('secret',{status:503}) : new Response(JSON.stringify({items:[event(1)],next_page_params:{block_number:122,index:4}})));
  const partial=await call('getNFTTransferRecipients',{chain:1,address:sender,collection});
  assert.equal(partial.events.length,1); assert.equal(partial.coverage.allRecipientsEstablished,false); assert.equal(partial.error.category,'upstream_http');
  setFetch(async()=>new Response(JSON.stringify({items:[{amount:'2',token:{address_hash:collection,type:'ERC-1155'},token_instances:[{id:'1',value:'2',metadata:{image:'x'.repeat(100000)}}]}],next_page_params:null})));
  const ownership=await call('getAddressNFTCollections',{chain:1,address:sender}); assert.equal(ownership.kind,'ownership');
  assert.equal(ownership.items[0].tokens[0].quantity,'2'); assert.ok(JSON.stringify(ownership).length<2000);
  setFetch(async()=>new Response(JSON.stringify({address_hash:collection,name:'Synthetic collection',type:'ERC-721'})));
  assert.equal((await call('getTokenInfo',{chain:1,tokenContract:collection})).name,'Synthetic collection');
  return { syntheticSender:sender,syntheticCollection:collection, cases:'ERC721/ERC1155, exact quantities, filtering, multiple pages, overlap, empty, decoration, malformed, missing continuation, upstream failure, partial scan, ownership, failure then success' };
}
