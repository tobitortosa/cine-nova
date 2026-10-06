create or replace function crear_funcion(
  p_pelicula_id bigint, p_inicio timestamptz,
  p_formato formato_funcion, p_idioma idioma_funcion,
  p_precio numeric, p_precio_vip numeric default 0)
returns funciones language plpgsql security definer set search_path = public as $$
declare v_dur int; v_fin timestamptz; v_sala bigint; v_row funciones;
begin
  if not es_admin() then raise exception 'No autorizado'; end if;

  if p_inicio <= now() then
    raise exception 'No se puede programar una función que ya empezó o que es del pasado';
  end if;

  select duracion_min into v_dur from peliculas where id = p_pelicula_id;
  if v_dur is null then raise exception 'La película no existe'; end if;

  v_fin := p_inicio + (v_dur || ' minutes')::interval;

  select s.id into v_sala from salas s
  where not exists (
    select 1 from funciones f
    where f.sala_id = s.id
      and f.ocupacion && tstzrange(p_inicio, v_fin + interval '30 minutes', '[)'))
  order by s.id limit 1;

  if v_sala is null then
    raise exception 'No hay salas disponibles en ese horario';
  end if;

  insert into funciones (pelicula_id, sala_id, inicio, fin, formato, idioma, precio_base, precio_vip, creada_por)
  values (p_pelicula_id, v_sala, p_inicio, v_fin, p_formato, p_idioma, p_precio, p_precio_vip, auth.uid())
  returning * into v_row;

  return v_row;
end $$;

create or replace function fn_funciones_no_pasado()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.inicio is distinct from old.inicio and new.inicio <= now() then
    raise exception 'No se puede mover una función a un horario que ya empezó o que es del pasado';
  end if;
  return new;
end $$;

drop trigger if exists trg_funciones_no_pasado on funciones;
create trigger trg_funciones_no_pasado
  before update of inicio on funciones
  for each row execute function fn_funciones_no_pasado();

revoke execute on function fn_funciones_no_pasado() from public, anon, authenticated;
