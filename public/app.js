(function(){
  function j(u){return fetch(u,{credentials:'same-origin'}).then(function(r){if(r.status===401){location.replace('/login');throw 0}return r.json()})}
  Promise.all([j('/api/me'), j('/api/sync/status'), j('/api/summary'), j('/api/stages')]).then(function(x){
    var me=x[0], st=x[1], sum=x[2], stages=x[3];
    document.getElementById('who').textContent = me.nome + ' · ' + me.email;
    var b=document.getElementById('sync');
    b.className = 'badge ' + (st.mac_online ? 'on' : 'off');
    b.textContent = st.mac_online ? ('Mac online · ' + (st.last_push_at||'')) : (st.message || 'Mac offline');
    document.getElementById('nCards').textContent = sum.totals.cards;
    document.getElementById('nOpen').textContent = sum.totals.open;
    document.getElementById('nLate').textContent = sum.totals.atrasados;
    document.getElementById('stages').textContent = JSON.stringify(stages.stages, null, 2);
    document.getElementById('action').textContent = JSON.stringify(sum.action_now, null, 2);
  }).catch(function(){});
})();