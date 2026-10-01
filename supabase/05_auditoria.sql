create or replace function fn_auditar()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_id text;
  v_accion text;
  v_detalle jsonb;
  v_precio_viejo numeric;
  v_precio_nuevo numeric;
begin
  if tg_op = 'DELETE' then v_id := old.id::text; else v_id := new.id::text; end if;

  if tg_op = 'INSERT' then
    v_accion := 'crear';
    v_detalle := to_jsonb(new);
  elsif tg_op = 'DELETE' then
    v_accion := 'eliminar';
    v_detalle := to_jsonb(old);
  else
    v_accion := 'modificar';
    v_detalle := jsonb_build_object('antes', to_jsonb(old), 'despues', to_jsonb(new));

    if tg_table_name = 'funciones' then
      if new.precio_base is distinct from old.precio_base or new.precio_vip is distinct from old.precio_vip then
        v_accion := 'modificar_precio';
        v_detalle := jsonb_build_object(
          'precio_base_anterior', old.precio_base, 'precio_base_nuevo', new.precio_base,
          'precio_vip_anterior',  old.precio_vip,  'precio_vip_nuevo',  new.precio_vip);
      end if;
    elsif tg_table_name in ('productos','combos') then
      v_precio_viejo := old.precio; v_precio_nuevo := new.precio;
      if v_precio_nuevo is distinct from v_precio_viejo then
        v_accion := 'modificar_precio';
        v_detalle := jsonb_build_object('nombre', new.nombre,
          'precio_anterior', v_precio_viejo, 'precio_nuevo', v_precio_nuevo);
      end if;
    elsif tg_table_name = 'peliculas' then
      if new.precio_preventa is distinct from old.precio_preventa then
        v_accion := 'modificar_precio';
        v_detalle := jsonb_build_object('titulo', new.titulo,
          'preventa_anterior', old.precio_preventa, 'preventa_nuevo', new.precio_preventa);
      end if;
    elsif tg_table_name = 'cupones' then
      if new.porcentaje is distinct from old.porcentaje then
        v_accion := 'modificar_precio';
        v_detalle := jsonb_build_object('codigo', new.codigo,
          'porcentaje_anterior', old.porcentaje, 'porcentaje_nuevo', new.porcentaje);
      end if;
    elsif tg_table_name = 'recompensas' then
      if new.costo_puntos is distinct from old.costo_puntos then
        v_accion := 'modificar_precio';
        v_detalle := jsonb_build_object('nombre', new.nombre,
          'puntos_anterior', old.costo_puntos, 'puntos_nuevo', new.costo_puntos);
      end if;
    elsif tg_table_name = 'perfiles' then
      if new.rol is distinct from old.rol then
        v_accion := 'cambiar_rol';
        v_detalle := jsonb_build_object('email', new.email, 'rol_anterior', old.rol, 'rol_nuevo', new.rol);
      else
        return new;
      end if;
    end if;
  end if;

  insert into log_actividad (usuario_id, email, accion, entidad, entidad_id, detalle)
  values (auth.uid(), (select email from perfiles where id = auth.uid()),
          v_accion, tg_table_name, v_id, v_detalle);

  if tg_op = 'DELETE' then return old; else return new; end if;
end $$;

do $$
declare t text;
begin
  foreach t in array array['peliculas','funciones','salas','productos','combos',
                           'categorias','cupones','recompensas','perfiles']
  loop
    execute format('drop trigger if exists trg_auditar_%I on %I', t, t);
    execute format(
      'create trigger trg_auditar_%I after insert or update or delete on %I
       for each row execute function fn_auditar()', t, t);
  end loop;
end $$;

create or replace function limpiar_reservas_vencidas()
returns void language sql security definer set search_path = public as $$
  delete from reservas where expira_en < now();
$$;

grant execute on function limpiar_reservas_vencidas() to anon, authenticated;
