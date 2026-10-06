create extension if not exists btree_gist;

do $$ begin create type rol_usuario     as enum ('cliente','empleado','admin'); exception when duplicate_object then null; end $$;
do $$ begin create type tipo_butaca     as enum ('estandar','vip','accesible'); exception when duplicate_object then null; end $$;
do $$ begin create type formato_funcion as enum ('2D','3D','4D','5D');          exception when duplicate_object then null; end $$;
do $$ begin create type idioma_funcion  as enum ('castellano','subtitulada');   exception when duplicate_object then null; end $$;
do $$ begin create type estado_compra   as enum ('pagada','cancelada');         exception when duplicate_object then null; end $$;
do $$ begin create type tipo_cupon      as enum ('bienvenida','edad');          exception when duplicate_object then null; end $$;
do $$ begin create type tipo_recompensa as enum ('entrada','producto');         exception when duplicate_object then null; end $$;
do $$ begin create type medio_pago      as enum ('tarjeta_credito','tarjeta_debito','mercado_pago','sin_cargo'); exception when duplicate_object then null; end $$;

create table if not exists perfiles (
  id                     uuid primary key references auth.users(id) on delete cascade,
  email                  text not null,
  nombre                 text not null default '',
  apellido               text not null default '',
  fecha_nacimiento       date,
  tipo_sangre            text,
  color_ojos             text,
  dias_vacaciones        int,
  rol                    rol_usuario not null default 'cliente',
  puntos                 int not null default 0 check (puntos >= 0),
  credito                numeric(10,2) not null default 0 check (credito >= 0),
  cupon_bienvenida_usado boolean not null default false,
  creado_en              timestamptz not null default now()
);

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.perfiles (id, email, nombre, apellido, fecha_nacimiento,
                               tipo_sangre, color_ojos, dias_vacaciones)
  values (new.id, new.email,
    coalesce(new.raw_user_meta_data->>'nombre', ''),
    coalesce(new.raw_user_meta_data->>'apellido', ''),
    nullif(new.raw_user_meta_data->>'fecha_nacimiento','')::date,
    nullif(new.raw_user_meta_data->>'tipo_sangre',''),
    nullif(new.raw_user_meta_data->>'color_ojos',''),
    nullif(new.raw_user_meta_data->>'dias_vacaciones','')::int)
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

create or replace function public.es_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.perfiles where id = auth.uid() and rol = 'admin');
$$;

create or replace function public.es_empleado()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.perfiles where id = auth.uid() and rol in ('empleado','admin'));
$$;

create or replace function hoy_local()
returns date language sql stable as $$
  select (now() at time zone 'America/Argentina/Buenos_Aires')::date;
$$;

create or replace function public.fn_perfiles_proteger()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if coalesce(current_setting('app.bypass_perfil', true), '') <> 'on' and not public.es_admin() then
    new.rol := old.rol;
    new.puntos := old.puntos;
    new.credito := old.credito;
    new.cupon_bienvenida_usado := old.cupon_bienvenida_usado;
    new.email := old.email;
    new.creado_en := old.creado_en;
    if old.fecha_nacimiento is not null then
      new.fecha_nacimiento := old.fecha_nacimiento;
    end if;
  end if;
  return new;
end $$;

drop trigger if exists trg_perfiles_proteger on perfiles;
create trigger trg_perfiles_proteger
  before update on perfiles
  for each row execute function public.fn_perfiles_proteger();

create table if not exists generos (
  id     bigserial primary key,
  nombre text not null unique
);

create table if not exists peliculas (
  id                bigserial primary key,
  titulo            text not null,
  sinopsis          text not null default '',
  duracion_min      int  not null check (duracion_min > 0),
  imagen_url        text,
  banner_url        text,
  restriccion_edad  int  not null default 0 check (restriccion_edad in (0,13,18)),
  fecha_estreno     date,
  precio_preventa   numeric(10,2),
  en_cartelera      boolean not null default false,
  destacada         boolean not null default false,
  creado_en         timestamptz not null default now(),
  estreno_procesado boolean not null default false
);

create table if not exists peliculas_generos (
  pelicula_id bigint not null references peliculas(id) on delete cascade,
  genero_id   bigint not null references generos(id)   on delete cascade,
  primary key (pelicula_id, genero_id)
);

create table if not exists salas (
  id     bigserial primary key,
  nombre text not null unique
);

create table if not exists butacas (
  id      bigserial primary key,
  sala_id bigint not null references salas(id) on delete cascade,
  fila    char(1) not null,
  numero  int     not null,
  columna int     not null check (columna between 1 and 3),
  tipo    tipo_butaca not null,
  unique (sala_id, fila, numero)
);

create or replace function generar_butacas(p_sala_id bigint)
returns void language plpgsql as $$
declare
  v_i int; v_col int; v_j int; v_num int;
  v_fila char(1); v_tipo tipo_butaca; v_cols int[];
begin
  for v_i in 1..20 loop
    v_fila := chr(64 + v_i);
    if v_fila in ('J','K') then
      v_tipo := 'accesible'; v_cols := array[2,10,2];
    elsif v_fila in ('R','S','T') then
      v_tipo := 'vip';       v_cols := array[4,20,4];
    else
      v_tipo := 'estandar';  v_cols := array[4,20,4];
    end if;
    v_num := 0;
    for v_col in 1..3 loop
      for v_j in 1..v_cols[v_col] loop
        v_num := v_num + 1;
        insert into butacas (sala_id, fila, numero, columna, tipo)
        values (p_sala_id, v_fila, v_num, v_col, v_tipo)
        on conflict (sala_id, fila, numero) do nothing;
      end loop;
    end loop;
  end loop;
end $$;

create or replace function fn_salas_butacas()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform generar_butacas(new.id);
  return new;
end $$;

drop trigger if exists trg_salas_butacas on salas;
create trigger trg_salas_butacas
  after insert on salas
  for each row execute function fn_salas_butacas();

create table if not exists funciones (
  id          bigserial primary key,
  pelicula_id bigint not null references peliculas(id) on delete cascade,
  sala_id     bigint not null references salas(id),
  inicio      timestamptz not null,
  fin         timestamptz not null,
  formato     formato_funcion not null default '2D',
  idioma      idioma_funcion  not null default 'castellano',
  precio_base numeric(10,2) not null check (precio_base >= 0),
  precio_vip  numeric(10,2) not null default 0 check (precio_vip >= 0),
  creada_por  uuid references auth.users(id) on delete set null,
  creado_en   timestamptz not null default now(),
  ocupacion   tstzrange
);

create or replace function fn_funciones_ocupacion()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_duracion int; v_sala text;
begin
  select duracion_min into v_duracion from peliculas where id = new.pelicula_id;
  if v_duracion is null then
    raise exception 'La película no existe';
  end if;

  if tg_op = 'INSERT'
     or new.inicio is distinct from old.inicio
     or new.pelicula_id is distinct from old.pelicula_id
     or new.fin is distinct from old.fin then
    new.fin := new.inicio + make_interval(mins => v_duracion);
  end if;
  new.ocupacion := tstzrange(new.inicio, new.fin + interval '30 minutes', '[)');

  if new.precio_vip = 0 then
    new.precio_vip := round(new.precio_base * 1.5, 2);
  end if;
  if new.precio_vip < new.precio_base then
    raise exception 'El precio VIP no puede ser menor que el precio estándar';
  end if;

  if tg_op = 'UPDATE'
     and (new.pelicula_id is distinct from old.pelicula_id
          or new.inicio is distinct from old.inicio
          or new.sala_id is distinct from old.sala_id)
     and funcion_con_ventas(old.id) then
    if new.pelicula_id is distinct from old.pelicula_id then
      raise exception 'No se puede cambiar la película de una función con entradas vendidas';
    end if;
    raise exception 'No se puede cambiar el horario de una función con entradas vendidas';
  end if;

  if tg_op = 'UPDATE'
     and new.inicio is distinct from old.inicio
     and exists (select 1 from reservas r where r.funcion_id = old.id and r.expira_en > now()) then
    raise exception 'Hay personas eligiendo butacas para esta función, así que por ahora no se puede cambiar el horario. Probá de nuevo en unos minutos.';
  end if;

  if exists (select 1 from funciones f
              where f.sala_id = new.sala_id
                and f.id <> new.id
                and f.ocupacion && new.ocupacion) then
    select nombre into v_sala from salas where id = new.sala_id;
    raise exception 'Ya hay otra función en % en ese horario. Entre una función y la siguiente tiene que pasar media hora.',
      coalesce(v_sala, 'esa sala');
  end if;

  return new;
end $$;

drop trigger if exists trg_funciones_ocupacion on funciones;
create trigger trg_funciones_ocupacion
  before insert or update on funciones
  for each row execute function fn_funciones_ocupacion();

do $$ begin
  alter table funciones
    add constraint funciones_sin_solape
    exclude using gist (sala_id with =, ocupacion with &&);
exception when duplicate_table or duplicate_object then null; end $$;

create table if not exists categorias (
  id bigserial primary key,
  nombre text not null unique
);

create table if not exists productos (
  id           bigserial primary key,
  categoria_id bigint references categorias(id) on delete set null,
  nombre       text not null,
  descripcion  text not null default '',
  precio       numeric(10,2) not null check (precio >= 0),
  imagen_url   text,
  activo       boolean not null default true
);

create table if not exists combos (
  id                 bigserial primary key,
  nombre             text not null,
  descripcion        text not null default '',
  precio             numeric(10,2) not null check (precio >= 0),
  imagen_url         text,
  activo             boolean not null default true,
  entradas_incluidas int not null default 0,
  constraint combos_entradas_incluidas_rango check (entradas_incluidas between 0 and 10)
);

create table if not exists cupones (
  id          bigserial primary key,
  codigo      text not null unique,
  descripcion text not null default '',
  porcentaje  numeric(5,2) not null check (porcentaje > 0 and porcentaje <= 100),
  tipo        tipo_cupon not null,
  edad_minima int,
  activo      boolean not null default true
);

create table if not exists recompensas (
  id           bigserial primary key,
  nombre       text not null,
  tipo         tipo_recompensa not null,
  producto_id  bigint references productos(id) on delete cascade,
  costo_puntos int not null check (costo_puntos > 0),
  activo       boolean not null default true
);

create table if not exists compras (
  id                      bigserial primary key,
  usuario_id              uuid references auth.users(id) on delete set null,
  email_contacto          text not null,
  codigo                  text not null unique,
  funcion_id              bigint references funciones(id) on delete set null,
  subtotal                numeric(10,2) not null default 0,
  descuento               numeric(10,2) not null default 0,
  credito_usado           numeric(10,2) not null default 0,
  total                   numeric(10,2) not null default 0,
  puntos_ganados          int not null default 0,
  cupon_id                bigint references cupones(id) on delete set null,
  estado                  estado_compra not null default 'pagada',
  entrada_validada        boolean not null default false,
  entrada_validada_en     timestamptz,
  productos_entregados    boolean not null default false,
  productos_entregados_en timestamptz,
  creado_en               timestamptz not null default now(),
  medio_pago              medio_pago,
  tarjeta_marca           text,
  tarjeta_ultimos4        text,
  descuento_canjes        numeric(10,2) not null default 0,
  descuento_combos        numeric(10,2) not null default 0,
  requiere_adulto         boolean not null default false,
  adulto_codigo           text references compras(codigo) on delete set null,
  comprador_mayor         boolean,
  constraint compras_ultimos4_valido check (tarjeta_ultimos4 is null or tarjeta_ultimos4 ~ '^[0-9]{4}$')
);

create table if not exists entradas (
  id         bigserial primary key,
  compra_id  bigint not null references compras(id) on delete cascade,
  funcion_id bigint not null references funciones(id) on delete cascade,
  butaca_id  bigint not null references butacas(id),
  precio     numeric(10,2) not null,
  activa     boolean not null default true
);

create unique index if not exists entradas_butaca_unica
  on entradas (funcion_id, butaca_id) where activa;

create table if not exists compra_items (
  id              bigserial primary key,
  compra_id       bigint not null references compras(id) on delete cascade,
  producto_id     bigint references productos(id) on delete set null,
  combo_id        bigint references combos(id)    on delete set null,
  nombre          text not null,
  cantidad        int not null check (cantidad > 0),
  precio_unitario numeric(10,2) not null,
  entregado       boolean not null default false
);

create table if not exists reservas (
  id         bigserial primary key,
  funcion_id bigint not null references funciones(id) on delete cascade,
  butaca_id  bigint not null references butacas(id) on delete cascade,
  sesion     text not null,
  expira_en  timestamptz not null default now() + interval '8 minutes',
  unique (funcion_id, butaca_id)
);

create table if not exists resenias (
  id          bigserial primary key,
  pelicula_id bigint not null references peliculas(id) on delete cascade,
  usuario_id  uuid   not null references auth.users(id) on delete cascade,
  estrellas   int    not null check (estrellas between 1 and 5),
  comentario  text   not null default '',
  creado_en   timestamptz not null default now(),
  unique (pelicula_id, usuario_id),
  constraint resenias_comentario_largo check (char_length(comentario) <= 1000)
);

create table if not exists canjes (
  id              bigserial primary key,
  usuario_id      uuid not null references auth.users(id) on delete cascade,
  recompensa_id   bigint references recompensas(id) on delete set null,
  nombre          text not null,
  puntos_gastados int not null,
  creado_en       timestamptz not null default now(),
  codigo          text,
  tipo            tipo_recompensa,
  producto_id     bigint references productos(id) on delete set null,
  usado           boolean not null default false,
  usado_en        timestamptz,
  compra_id       bigint references compras(id) on delete set null
);

create unique index if not exists canjes_codigo_unico on canjes (codigo);

create table if not exists alertas_estreno (
  id          bigserial primary key,
  usuario_id  uuid   not null references auth.users(id) on delete cascade,
  pelicula_id bigint not null references peliculas(id)  on delete cascade,
  notificada  boolean not null default false,
  creado_en   timestamptz not null default now(),
  unique (usuario_id, pelicula_id)
);

create table if not exists log_actividad (
  id         bigserial primary key,
  usuario_id uuid references auth.users(id) on delete set null,
  email      text,
  accion     text not null,
  entidad    text not null,
  entidad_id text,
  detalle    jsonb,
  creado_en  timestamptz not null default now()
);

create table if not exists cancelaciones_invitado (
  compra_id      bigint primary key references compras(id) on delete cascade,
  clave_hash     text not null check (clave_hash ~ '^[0-9a-f]{64}$'),
  solicitado_por uuid not null references perfiles(id) on delete cascade,
  expira_en      timestamptz not null,
  intentos       int not null default 0,
  envios         int not null default 1,
  ventana_desde  timestamptz not null default now(),
  ultimo_envio   timestamptz not null default now(),
  usado_en       timestamptz
);

create index if not exists idx_funciones_pelicula    on funciones(pelicula_id);
create index if not exists idx_funciones_inicio      on funciones(inicio);
create index if not exists idx_entradas_funcion      on entradas(funcion_id);
create index if not exists idx_compras_usuario       on compras(usuario_id);
create index if not exists idx_compras_creado        on compras(creado_en);
create index if not exists idx_compras_adulto_codigo on compras(adulto_codigo) where adulto_codigo is not null;
create index if not exists idx_resenias_pelicula     on resenias(pelicula_id);
create index if not exists idx_reservas_funcion      on reservas(funcion_id);
create index if not exists idx_log_creado            on log_actividad(creado_en desc);

create or replace function funcion_con_ventas(p_funcion_id bigint)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from entradas e
                   join compras c on c.id = e.compra_id
                  where e.funcion_id = p_funcion_id and e.activa and c.estado = 'pagada');
$$;

create or replace function fn_funciones_proteger_ventas()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if funcion_con_ventas(old.id) then
    raise exception 'La función del % tiene entradas vendidas y no se puede eliminar. Para retirar la película, sacala de cartelera en lugar de borrarla.',
      to_char(old.inicio at time zone 'America/Argentina/Buenos_Aires', 'DD/MM HH24:MI');
  end if;
  return old;
end $$;

drop trigger if exists trg_funciones_proteger_ventas on funciones;
create trigger trg_funciones_proteger_ventas
  before delete on funciones
  for each row execute function fn_funciones_proteger_ventas();

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

create or replace function fn_peliculas_estreno()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.en_cartelera then
    new.estreno_procesado := true;
  elsif tg_op = 'UPDATE'
        and new.fecha_estreno is distinct from old.fecha_estreno
        and new.fecha_estreno > hoy_local() then
    new.estreno_procesado := false;
  elsif tg_op = 'UPDATE' and old.en_cartelera then
    new.estreno_procesado := true;
  end if;
  return new;
end $$;

drop trigger if exists trg_peliculas_estreno on peliculas;
create trigger trg_peliculas_estreno
  before insert or update on peliculas
  for each row execute function fn_peliculas_estreno();

create or replace function fn_peliculas_duracion()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_inicio timestamptz;
begin
  select f.inicio into v_inicio
    from funciones f
   where f.pelicula_id = new.id
     and f.inicio > now()
     and exists (select 1 from funciones o
                  where o.sala_id = f.sala_id
                    and o.id <> f.id
                    and o.ocupacion && tstzrange(f.inicio,
                                                 f.inicio + make_interval(mins => new.duracion_min) + interval '30 minutes',
                                                 '[)'))
   order by f.inicio
   limit 1;

  if found then
    raise exception 'Con la nueva duración, la función del % se superpone con otra de la misma sala. Reprogramala antes de cambiar la duración.',
      to_char(v_inicio at time zone 'America/Argentina/Buenos_Aires', 'DD/MM HH24:MI');
  end if;

  update funciones set fin = inicio + make_interval(mins => new.duracion_min)
   where pelicula_id = new.id and inicio > now();

  return new;
end $$;

drop trigger if exists trg_peliculas_duracion on peliculas;
create trigger trg_peliculas_duracion
  after update of duracion_min on peliculas
  for each row when (new.duracion_min is distinct from old.duracion_min)
  execute function fn_peliculas_duracion();

create or replace function fn_productos_proteger()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if exists (select 1 from canjes where producto_id = old.id and not usado) then
    raise exception 'Ese producto tiene canjes pendientes: desactivalo en lugar de borrarlo';
  end if;
  if exists (select 1 from recompensas where producto_id = old.id and activo) then
    raise exception 'Ese producto es parte de una recompensa activa: desactivalo en lugar de borrarlo, o primero desactivá la recompensa';
  end if;
  return old;
end $$;

drop trigger if exists trg_productos_proteger on productos;
create trigger trg_productos_proteger
  before delete on productos
  for each row execute function fn_productos_proteger();

create or replace function fn_resenias_estreno()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if not exists (
    select 1 from peliculas p
     where p.id = new.pelicula_id
       and (p.en_cartelera
            or (p.fecha_estreno is not null and p.fecha_estreno <= hoy_local())
            or exists (select 1 from funciones f where f.pelicula_id = p.id and f.inicio <= now()))) then
    raise exception 'Solo se pueden reseñar películas que ya se estrenaron';
  end if;
  return new;
end $$;

drop trigger if exists trg_resenias_estreno on resenias;
create trigger trg_resenias_estreno
  before insert or update of pelicula_id on resenias
  for each row execute function fn_resenias_estreno();
