do $$
begin
  create extension if not exists pg_net;
exception when others then
  raise notice 'pg_net no disponible: los correos quedan registrados pero no se envían';
end $$;

do $$ begin create type estado_correo as enum ('sin_configurar','enviado','fallido'); exception when duplicate_object then null; end $$;

create table if not exists configuracion (
  clave       text primary key,
  valor       text not null default '',
  descripcion text not null default ''
);

alter table configuracion enable row level security;

insert into configuracion (clave, valor, descripcion) values
  ('brevo_api_key',    '',                                  'Clave de API de Brevo. Panel de Brevo, sección SMTP & API.'),
  ('correo_remitente', '',                                  'Dirección verificada en Brevo desde la que salen los correos.'),
  ('nombre_remitente', 'CineNova',                          'Nombre que ve la persona en su bandeja de entrada.'),
  ('url_app',          'https://cine-nova-seven.vercel.app','Dirección pública de la aplicación, usada en los enlaces.')
on conflict (clave) do nothing;

create table if not exists correos (
  id           bigserial primary key,
  destinatario text not null,
  asunto       text not null,
  motivo       text not null,
  estado       estado_correo not null,
  detalle      text,
  creado_en    timestamptz not null default now()
);

create index if not exists idx_correos_creado on correos(creado_en desc);

alter table correos enable row level security;

drop policy if exists correos_select on correos;
create policy correos_select on correos for select using (es_admin());

create or replace function valor_de_configuracion(p_clave text)
returns text language sql stable security definer set search_path = public as $$
  select nullif(trim(c.valor), '') from public.configuracion c where c.clave = p_clave;
$$;

revoke execute on function valor_de_configuracion(text) from public, anon, authenticated;

create or replace function formato_pesos(p_monto numeric)
returns text language sql immutable as $$
  select '$ ' || replace(to_char(round(coalesce(p_monto, 0)), 'FM999,999,990'), ',', '.');
$$;

create or replace function plantilla_correo(
  p_titulo text, p_bajada text, p_cuerpo text,
  p_boton_texto text default null, p_boton_url text default null)
returns text language sql immutable as $$
  select
  '<!doctype html><html lang="es"><head><meta charset="utf-8">'
  || '<meta name="viewport" content="width=device-width,initial-scale=1"></head>'
  || '<body style="margin:0;padding:0;background:#0a0b10;">'
  || '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#0a0b10;padding:32px 16px;">'
  || '<tr><td align="center">'
  || '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#12141c;border:1px solid #2a2f40;border-radius:16px;overflow:hidden;">'
  || '<tr><td style="padding:28px 32px 20px;border-bottom:1px solid #2a2f40;">'
  || '<span style="font:800 22px/1 Helvetica,Arial,sans-serif;color:#f2f3f7;letter-spacing:-.5px;">Cine</span>'
  || '<span style="font:800 22px/1 Helvetica,Arial,sans-serif;color:#f5b43c;letter-spacing:-.5px;">Nova</span>'
  || '</td></tr>'
  || '<tr><td style="padding:32px;">'
  || '<h1 style="margin:0 0 10px;font:700 25px/1.2 Helvetica,Arial,sans-serif;color:#f2f3f7;">' || p_titulo || '</h1>'
  || case when coalesce(p_bajada,'') = '' then ''
     else '<p style="margin:0 0 24px;font:400 15px/1.6 Helvetica,Arial,sans-serif;color:#a8adbd;">' || p_bajada || '</p>' end
  || coalesce(p_cuerpo, '')
  || case when coalesce(p_boton_url,'') = '' then ''
     else '<table role="presentation" cellpadding="0" cellspacing="0" style="margin:28px 0 4px;"><tr><td style="background:#f5b43c;border-radius:10px;">'
          || '<a href="' || p_boton_url || '" style="display:inline-block;padding:13px 26px;font:700 15px Helvetica,Arial,sans-serif;color:#14161d;text-decoration:none;">'
          || coalesce(p_boton_texto,'Ver') || '</a></td></tr></table>' end
  || '</td></tr>'
  || '<tr><td style="padding:20px 32px 28px;border-top:1px solid #2a2f40;">'
  || '<p style="margin:0;font:400 12px/1.6 Helvetica,Arial,sans-serif;color:#6b7185;">'
  || 'CineNova &middot; Av. Siempre Viva 1234, Buenos Aires<br>'
  || 'Este correo se envió automáticamente, no hace falta responderlo.</p>'
  || '</td></tr></table></td></tr></table></body></html>';
$$;

create or replace function enviar_correo(
  p_destinatario text, p_asunto text, p_html text, p_motivo text)
returns void language plpgsql security definer
set search_path = public, extensions, net, pg_temp as $$
declare
  v_clave     text := valor_de_configuracion('brevo_api_key');
  v_remitente text := valor_de_configuracion('correo_remitente');
  v_nombre    text := coalesce(valor_de_configuracion('nombre_remitente'), 'CineNova');
  v_esquema   text;
begin
  if p_destinatario is null or position('@' in p_destinatario) < 2 then
    return;
  end if;

  if v_clave is null or v_remitente is null then
    insert into correos (destinatario, asunto, motivo, estado, detalle)
    values (p_destinatario, p_asunto, p_motivo, 'sin_configurar',
            'Falta cargar brevo_api_key o correo_remitente en la tabla configuracion.');
    return;
  end if;

  select n.nspname into v_esquema
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where p.proname = 'http_post' and n.nspname in ('net','extensions') and p.pronargs >= 4
   order by (n.nspname = 'net') desc limit 1;

  if v_esquema is null then
    insert into correos (destinatario, asunto, motivo, estado, detalle)
    values (p_destinatario, p_asunto, p_motivo, 'fallido', 'La extensión pg_net no está disponible.');
    return;
  end if;

  execute format('select %I.http_post(url := $1, body := $2, headers := $3, timeout_milliseconds := $4)', v_esquema)
  using
    'https://api.brevo.com/v3/smtp/email',
    jsonb_build_object(
      'sender',      jsonb_build_object('name', v_nombre, 'email', v_remitente),
      'to',          jsonb_build_array(jsonb_build_object('email', p_destinatario)),
      'subject',     p_asunto,
      'htmlContent', p_html),
    jsonb_build_object('Content-Type','application/json','api-key',v_clave,'accept','application/json'),
    8000;

  insert into correos (destinatario, asunto, motivo, estado, detalle)
  values (p_destinatario, p_asunto, p_motivo, 'enviado', null);

exception when others then
  insert into correos (destinatario, asunto, motivo, estado, detalle)
  values (p_destinatario, p_asunto, p_motivo, 'fallido', sqlerrm);
end $$;

revoke execute on function enviar_correo(text, text, text, text) from public, anon, authenticated;

create or replace function descripcion_medio_pago(p_compra compras)
returns text language sql immutable as $$
  select case p_compra.medio_pago
    when 'tarjeta_credito' then 'Tarjeta de crédito ' || coalesce(p_compra.tarjeta_marca, '') || ' terminada en ' || coalesce(p_compra.tarjeta_ultimos4, '----')
    when 'tarjeta_debito'  then 'Tarjeta de débito '  || coalesce(p_compra.tarjeta_marca, '') || ' terminada en ' || coalesce(p_compra.tarjeta_ultimos4, '----')
    when 'mercado_pago'    then 'Mercado Pago'
    when 'sin_cargo'       then 'Sin cargo'
    else 'No registrado'
  end;
$$;

create or replace function linea_correo(p_etiqueta text, p_valor text, p_color text default '#a8adbd')
returns text language sql immutable as $$
  select '<tr><td style="font:400 14px Helvetica,Arial,sans-serif;color:#a8adbd;padding:4px 0;">' || p_etiqueta || '</td>'
      || '<td align="right" style="font:600 14px Helvetica,Arial,sans-serif;color:' || p_color || ';padding:4px 0;">' || p_valor || '</td></tr>';
$$;

create or replace function correo_de_compra(p_compra_id bigint)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_c compras; v_f funciones; v_p peliculas; v_sala text;
  v_butacas text; v_items text; v_cuerpo text; v_url text;
  v_fila record;
begin
  select * into v_c from compras where id = p_compra_id;
  if not found then return; end if;

  select * into v_f from funciones where id = v_c.funcion_id;
  select * into v_p from peliculas where id = v_f.pelicula_id;
  select nombre into v_sala from salas where id = v_f.sala_id;

  select string_agg(b.fila || b.numero ||
           case b.tipo when 'vip' then ' (VIP)' when 'accesible' then ' (accesible)' else '' end,
           ', ' order by b.fila, b.numero)
    into v_butacas
    from entradas e join butacas b on b.id = e.butaca_id
   where e.compra_id = v_c.id and e.activa;

  v_items := '';
  for v_fila in select nombre, cantidad from compra_items where compra_id = v_c.id order by id loop
    v_items := v_items || '<tr><td style="padding:6px 0;font:400 14px Helvetica,Arial,sans-serif;color:#a8adbd;">'
            || v_fila.cantidad || ' &times; ' || v_fila.nombre || '</td></tr>';
  end loop;

  v_url := coalesce(valor_de_configuracion('url_app'), '') || '/compra/' || v_c.codigo;

  v_cuerpo :=
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#1a1d28;border-radius:12px;padding:20px 22px;">'
    || '<tr><td style="font:700 19px Helvetica,Arial,sans-serif;color:#f2f3f7;padding-bottom:14px;">' || v_p.titulo || '</td></tr>'
    || '<tr><td style="font:400 14px/1.9 Helvetica,Arial,sans-serif;color:#a8adbd;">'
    || '<strong style="color:#f2f3f7;">Función:</strong> '
    || to_char(v_f.inicio at time zone 'America/Argentina/Buenos_Aires', 'DD/MM/YYYY') || ' a las '
    || to_char(v_f.inicio at time zone 'America/Argentina/Buenos_Aires', 'HH24:MI') || ' h<br>'
    || '<strong style="color:#f2f3f7;">Sala:</strong> ' || coalesce(v_sala, 'A confirmar')
    || ' &middot; ' || v_f.formato || ' &middot; ' || initcap(v_f.idioma::text) || '<br>'
    || '<strong style="color:#f2f3f7;">Butacas:</strong> ' || coalesce(v_butacas, '-')
    || '</td></tr></table>'
    || case when v_items = '' then ''
       else '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:14px;background:#1a1d28;border-radius:12px;padding:16px 22px;">'
            || '<tr><td style="font:700 12px Helvetica,Arial,sans-serif;color:#f5b43c;letter-spacing:1px;padding-bottom:6px;">CANDY BAR</td></tr>'
            || v_items || '</table>' end
    || '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:14px;">'
    || linea_correo('Subtotal', formato_pesos(v_c.subtotal))
    || case when v_c.descuento_canjes > 0 then linea_correo('Canje de puntos', '&minus; ' || formato_pesos(v_c.descuento_canjes), '#3fcf8e') else '' end
    || case when v_c.descuento > 0 then linea_correo('Cupón de descuento', '&minus; ' || formato_pesos(v_c.descuento), '#3fcf8e') else '' end
    || case when v_c.credito_usado > 0 then linea_correo('Crédito usado', '&minus; ' || formato_pesos(v_c.credito_usado), '#3fcf8e') else '' end
    || '<tr><td style="font:700 15px Helvetica,Arial,sans-serif;color:#f2f3f7;padding:10px 0 4px;border-top:1px solid #2a2f40;">Total abonado</td>'
    || '<td align="right" style="font:700 19px Helvetica,Arial,sans-serif;color:#f5b43c;padding:10px 0 4px;border-top:1px solid #2a2f40;">' || formato_pesos(v_c.total) || '</td></tr>'
    || linea_correo('Medio de pago', descripcion_medio_pago(v_c), '#f2f3f7')
    || case when v_c.puntos_ganados > 0 then linea_correo('Puntos sumados', v_c.puntos_ganados::text, '#ffd27f') else '' end
    || '</table>'
    || '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:22px;background:#0a0b10;border:1px dashed #2a2f40;border-radius:12px;padding:18px;">'
    || '<tr><td align="center">'
    || '<div style="font:700 11px Helvetica,Arial,sans-serif;color:#6b7185;letter-spacing:2px;">CÓDIGO DE COMPRA</div>'
    || '<div style="font:700 24px/1.6 Courier New,monospace;color:#f5b43c;letter-spacing:4px;">' || v_c.codigo || '</div>'
    || '<div style="font:400 13px/1.6 Helvetica,Arial,sans-serif;color:#a8adbd;">Mostrá el código QR desde el enlace de abajo para ingresar a la sala y retirar tu pedido del candy bar. Es de un solo uso.</div>'
    || '</td></tr></table>'
    || case when v_p.restriccion_edad > 0
       then '<p style="margin:18px 0 0;padding:12px 16px;background:rgba(240,82,79,.12);border-radius:10px;font:600 13px/1.5 Helvetica,Arial,sans-serif;color:#f0524f;">Película +'
            || v_p.restriccion_edad || ': los menores deben ingresar acompañados por un adulto.</p>'
       else '' end;

  perform enviar_correo(
    v_c.email_contacto,
    'Tu entrada para ' || v_p.titulo || ' · código ' || v_c.codigo,
    plantilla_correo('Tu compra quedó confirmada',
      'Guardá este correo: con el código de abajo entrás a la sala y retirás el candy bar.',
      v_cuerpo, 'Ver mi entrada con el QR', v_url),
    'compra_confirmada');
end $$;

create or replace function fn_correo_cancelacion()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_p peliculas; v_f funciones; v_cuerpo text; v_canjes boolean;
begin
  if new.estado <> 'cancelada' or old.estado = 'cancelada' then return new; end if;

  select * into v_f from funciones where id = new.funcion_id;
  select * into v_p from peliculas where id = v_f.pelicula_id;

  v_canjes := new.descuento_canjes > 0
           or exists (select 1 from compra_items ci
                       where ci.compra_id = new.id and ci.precio_unitario = 0 and ci.nombre like '% (canje)');

  v_cuerpo :=
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#1a1d28;border-radius:12px;padding:20px 22px;">'
    || '<tr><td style="font:400 14px/1.9 Helvetica,Arial,sans-serif;color:#a8adbd;">'
    || '<strong style="color:#f2f3f7;">Película:</strong> ' || coalesce(v_p.titulo, '-') || '<br>'
    || '<strong style="color:#f2f3f7;">Código:</strong> ' || new.codigo || '<br>'
    || '<strong style="color:#f2f3f7;">Crédito acreditado:</strong> <span style="color:#3fcf8e;">'
    || formato_pesos(new.total + new.credito_usado) || '</span>'
    || '</td></tr></table>'
    || '<p style="margin:18px 0 0;font:400 14px/1.7 Helvetica,Arial,sans-serif;color:#a8adbd;">'
    || 'El importe quedó como crédito en tu cuenta y lo podés usar en tu próxima compra, '
    || 'combinándolo con cualquier otro medio de pago.</p>'
    || case when v_canjes
       then '<p style="margin:12px 0 0;font:400 14px/1.7 Helvetica,Arial,sans-serif;color:#a8adbd;">'
            || 'Los canjes de puntos que habías usado volvieron a quedar disponibles en tu cuenta.</p>'
       else '' end;

  perform enviar_correo(
    new.email_contacto,
    'Cancelamos tu compra ' || new.codigo,
    plantilla_correo('Tu compra fue cancelada',
      'Ya te acreditamos el importe como crédito en tu cuenta.',
      v_cuerpo, 'Ver mis compras',
      coalesce(valor_de_configuracion('url_app'),'') || '/cuenta/compras'),
    'compra_cancelada');
  return new;
end $$;

drop trigger if exists trg_correo_cancelacion on compras;
create trigger trg_correo_cancelacion
  after update of estado on compras
  for each row execute function fn_correo_cancelacion();

create or replace function fn_correo_bienvenida()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_cupon cupones; v_cuerpo text;
begin
  select * into v_cupon from cupones where tipo = 'bienvenida' and activo limit 1;
  if not found then return new; end if;

  v_cuerpo :=
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#1a1d28;border:1px solid #f5b43c;border-radius:12px;padding:24px;">'
    || '<tr><td align="center">'
    || '<div style="font:700 11px Helvetica,Arial,sans-serif;color:#f5b43c;letter-spacing:2px;">TU CUPÓN DE BIENVENIDA</div>'
    || '<div style="font:800 32px/1.5 Courier New,monospace;color:#ffd27f;letter-spacing:3px;">' || v_cupon.codigo || '</div>'
    || '<div style="font:700 17px Helvetica,Arial,sans-serif;color:#f2f3f7;">'
    || to_char(v_cupon.porcentaje, 'FM999') || '% de descuento en tu primera compra</div>'
    || '</td></tr></table>'
    || '<p style="margin:22px 0 0;font:400 14px/1.7 Helvetica,Arial,sans-serif;color:#a8adbd;">'
    || 'Además, desde ahora sumás 1 punto por cada peso que gastes. Los podés canjear por '
    || 'entradas gratis y productos del candy bar.</p>';

  perform enviar_correo(
    new.email,
    'Bienvenido a CineNova: te regalamos un ' || to_char(v_cupon.porcentaje,'FM999') || '% de descuento',
    plantilla_correo('Ya sos parte de CineNova',
      'Tu cuenta quedó creada. Te esperamos en la sala.',
      v_cuerpo, 'Ver la cartelera',
      coalesce(valor_de_configuracion('url_app'),'') || '/peliculas'),
    'bienvenida');
  return new;
end $$;

drop trigger if exists trg_correo_bienvenida on perfiles;
create trigger trg_correo_bienvenida
  after insert on perfiles
  for each row execute function fn_correo_bienvenida();

create or replace function notificar_apertura_venta(p_pelicula_id bigint)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_p peliculas; v_a record; v_cuerpo text; v_url text;
  v_preventa boolean; v_asunto text; v_titulo text; v_bajada text;
begin
  select * into v_p from peliculas where id = p_pelicula_id;
  if not found or not venta_abierta(p_pelicula_id) then return; end if;

  v_preventa := preventa_vigente(p_pelicula_id);
  v_url := coalesce(valor_de_configuracion('url_app'),'') || '/peliculas/' || v_p.id;

  if v_preventa then
    v_asunto := 'Abrió la preventa de ' || v_p.titulo;
    v_titulo := 'Se abrió la preventa';
    v_bajada := 'Activaste una alerta para esta película y ya podés comprar tus entradas a precio especial.';
  else
    v_asunto := 'Ya podés comprar tus entradas para ' || v_p.titulo;
    v_titulo := 'Se abrió la venta';
    v_bajada := 'Activaste una alerta para esta película y ya tiene funciones disponibles.';
  end if;

  v_cuerpo :=
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#1a1d28;border-radius:12px;padding:20px 22px;">'
    || '<tr><td style="font:700 19px Helvetica,Arial,sans-serif;color:#f2f3f7;padding-bottom:8px;">' || v_p.titulo || '</td></tr>'
    || '<tr><td style="font:400 14px/1.7 Helvetica,Arial,sans-serif;color:#a8adbd;">' || left(v_p.sinopsis, 260) || '</td></tr>'
    || '</table>'
    || case when v_preventa
       then '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:14px;background:#1a1d28;border:1px solid #f5b43c;border-radius:12px;padding:18px 22px;">'
            || '<tr><td style="font:400 14px/1.7 Helvetica,Arial,sans-serif;color:#a8adbd;">'
            || '<strong style="color:#ffd27f;">Precio de preventa: ' || formato_pesos(v_p.precio_preventa) || '</strong><br>'
            || 'Vale hasta el ' || to_char(v_p.fecha_estreno - 1, 'DD/MM') || '. Desde el estreno, el '
            || to_char(v_p.fecha_estreno, 'DD/MM') || ', las entradas vuelven a su precio normal.'
            || '</td></tr></table>'
       else '' end;

  for v_a in
    select a.id, pf.email
      from alertas_estreno a
      join perfiles pf on pf.id = a.usuario_id
     where a.pelicula_id = p_pelicula_id and a.notificada = false
     for update of a
  loop
    perform enviar_correo(v_a.email, v_asunto,
      plantilla_correo(v_titulo, v_bajada, v_cuerpo, 'Ver funciones y comprar', v_url),
      'alerta_estreno');
    update alertas_estreno set notificada = true where id = v_a.id;
  end loop;
end $$;

revoke execute on function notificar_apertura_venta(bigint) from public, anon, authenticated;

create or replace function fn_correo_estreno()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if venta_abierta(new.id) then
    perform notificar_apertura_venta(new.id);
  end if;
  return new;
end $$;

drop trigger if exists trg_correo_estreno on peliculas;
create trigger trg_correo_estreno
  after update of en_cartelera, fecha_estreno, precio_preventa on peliculas
  for each row execute function fn_correo_estreno();

create or replace function abrir_ventas_del_dia()
returns void language plpgsql security definer set search_path = public as $$
declare v_id bigint;
begin
  update peliculas set en_cartelera = true
   where not en_cartelera and fecha_estreno is not null and fecha_estreno <= hoy_local();

  for v_id in
    select distinct a.pelicula_id from alertas_estreno a
     where a.notificada = false and venta_abierta(a.pelicula_id)
  loop
    perform notificar_apertura_venta(v_id);
  end loop;

  delete from reservas where expira_en < now();
end $$;

revoke execute on function abrir_ventas_del_dia() from public, anon, authenticated;

do $$
begin
  create extension if not exists pg_cron;
  perform cron.schedule('cinenova-abrir-ventas', '5 * * * *', 'select public.abrir_ventas_del_dia()');
exception when others then
  raise notice 'pg_cron no disponible (%): la apertura automática de ventas queda desactivada', sqlerrm;
end $$;
