do $$
declare
  v_id uuid;
  r record;
begin
  for r in select * from (values
    ('admin@cinenova.app',    'admin1234',    'admin',    '{"nombre":"Lucía","apellido":"Ferreyra","fecha_nacimiento":"1988-03-21","tipo_sangre":"O+","color_ojos":"Marrones","dias_vacaciones":21}'),
    ('empleado@cinenova.app', 'empleado1234', 'empleado', '{"nombre":"Martín","apellido":"Quiroga","fecha_nacimiento":"1999-11-02","tipo_sangre":"A-","color_ojos":"Verdes","dias_vacaciones":14}'),
    ('cliente@cinenova.app',  'cliente1234',  'cliente',  '{"nombre":"Sofía","apellido":"Benítez","fecha_nacimiento":"1996-07-15","tipo_sangre":"B+","color_ojos":"Miel","dias_vacaciones":18}'),
    ('mayor@cinenova.app',    'mayor1234',    'cliente',  '{"nombre":"Héctor","apellido":"Álvarez","fecha_nacimiento":"1962-02-09","tipo_sangre":"AB+","color_ojos":"Grises","dias_vacaciones":30}'),
    ('menor@cinenova.app',    'menor1234',    'cliente',  '{"nombre":"Tomás","apellido":"Rivas","fecha_nacimiento":"2010-03-15","tipo_sangre":"A+","color_ojos":"Marrones","dias_vacaciones":14}')
  ) as t(email, pass, rol, meta)
  loop
    if exists (select 1 from auth.users u where u.email = r.email) then continue; end if;

    v_id := gen_random_uuid();

    insert into auth.users (
      instance_id, id, aud, role, email, encrypted_password,
      email_confirmed_at, created_at, updated_at,
      raw_app_meta_data, raw_user_meta_data,
      confirmation_token, recovery_token, email_change_token_new, email_change,
      phone_change, phone_change_token, email_change_token_current, reauthentication_token
    ) values (
      '00000000-0000-0000-0000-000000000000', v_id, 'authenticated', 'authenticated',
      r.email, extensions.crypt(r.pass, extensions.gen_salt('bf')),
      now(), now(), now(),
      '{"provider":"email","providers":["email"]}'::jsonb, r.meta::jsonb,
      '', '', '', '', '', '', '', ''
    );

    insert into auth.identities (
      provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at
    ) values (
      v_id::text, v_id,
      jsonb_build_object('sub', v_id::text, 'email', r.email, 'email_verified', true),
      'email', now(), now(), now()
    );

    perform set_config('app.bypass_perfil', 'on', true);
    update perfiles set rol = r.rol::rol_usuario, credito = case when r.rol = 'cliente' then 5000 else 0 end
     where id = v_id;
  end loop;
end $$;
