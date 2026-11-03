import test from 'node:test';
import assert from 'node:assert/strict';
import {callFcmMessage,fallbackCallFcmMessage,parkingFcmMessage} from '../voice-service.mjs';

test('call uses a data message for full-screen UI and a notification fallback for background delivery',()=>{
  const primary=callFcmMessage('device-token','call-123',1234);
  assert.equal(primary.android.priority,'HIGH');
  assert.equal(primary.data.sentAtMs,'1234');
  assert.equal(primary.notification,undefined,'the primary call must reach onMessageReceived');
  const backup=fallbackCallFcmMessage('device-token','call-123');
  assert.equal(backup.data.callId,'call-123');
  assert.equal(backup.notification.title,'有人请求挪车');
  assert.equal(backup.android.notification.channel_id,'movecar_voice_calls_v3');
});

test('parking alerts carry notification and data for background and foreground handling',()=>{
  const message=parkingFcmMessage('device-token','有人请求挪车','请挪车','https://car.example/owner');
  assert.equal(message.data.type,'move_request');
  assert.equal(message.notification.body,'点击查看挪车请求');
  assert.equal(message.android.priority,'HIGH');
  assert.equal(message.android.notification.channel_id,'movecar_parking_alerts');
});
