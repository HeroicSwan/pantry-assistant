update sms_settings
set sending_mode = 'simulation', updated_at = now()
where sending_mode = 'twilio_test';

alter table sms_settings drop constraint if exists sms_settings_mode_check;
alter table sms_settings add constraint sms_settings_mode_check
  check (sending_mode in ('disabled', 'simulation', 'live'));
