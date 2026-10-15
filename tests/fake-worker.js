// Only for adapter integration tests. Not a copy of the real project.
addEventListener('fetch', event => event.respondWith(handleRequest(event.request)));
async function handleRequest(request) {
  const url = new URL(request.url);
  if (url.pathname === '/api/notify') {
    const body = await request.json();
    await MOVE_CAR_STATUS.put('notify_status', 'waiting', { expirationTtl: 600 });
    if (body.location) await MOVE_CAR_STATUS.put('requester_location', JSON.stringify(body.location), { expirationTtl: 3600 });
    const confirmUrl = encodeURIComponent(url.origin + '/owner-confirm');
    const target = `${BARK_URL}/挪车请求/${encodeURIComponent(body.message)}?group=MoveCar&url=${confirmUrl}`;
    const pushed = await fetch(target);
    return new Response(JSON.stringify({success: pushed.ok}), {status: pushed.ok ? 200 : 500});
  }
  if (url.pathname === '/api/check-status') {
    return new Response(JSON.stringify({status: (await MOVE_CAR_STATUS.get('notify_status')) || 'waiting'}));
  }
  if (url.pathname === '/api/get-location') {
    return new Response((await MOVE_CAR_STATUS.get('requester_location')) || '{}');
  }
  if (url.pathname === '/api/owner-confirm') {
    await MOVE_CAR_STATUS.put('notify_status', 'confirmed', {expirationTtl:600});
    return new Response(JSON.stringify({success: true}));
  }
  if (url.pathname === '/owner-confirm') return new Response('<h1>Owner page</h1>', {headers:{'Content-Type':'text/html'}});
  return new Response('<h1>MoveCar requester</h1>', {headers:{'Content-Type':'text/html'}});
}
