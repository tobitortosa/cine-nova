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

create or replace function public.fn_perfiles_proteger()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if coalesce(current_setting('app.bypass_perfil', true), '') <> 'on' and not public.es_admin() then
    new.rol := old.rol;
    new.puntos := old.puntos;
    new.credito := old.credito;
    new.cupon_bienvenida_usado := old.cupon_bienvenida_usado;
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
  id               bigserial primary key,
  titulo           text not null,
  sinopsis         text not null default '',
  duracion_min     int  not null check (duracion_min > 0),
  imagen_url       text,
  banner_url       text,
  restriccion_edad int  not null default 0 check (restriccion_edad in (0,13,18)),
  fecha_estreno    date,
  precio_preventa  numeric(10,2),
  en_cartelera     boolean not null default false,
  destacada        boolean not null default false,
  creado_en        timestamptz not null default now()
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
returns trigger language plpgsql as $$
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
returns trigger language plpgsql as $$
begin
  new.ocupacion := tstzrange(new.inicio, new.fin + interval '30 minutes', '[)');
  if new.precio_vip = 0 then
    new.precio_vip := round(new.precio_base * 1.5, 2);
  end if;
  if new.precio_vip < new.precio_base then
    raise exception 'El precio VIP no puede ser menor que el precio estándar';
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
  id          bigserial primary key,
  nombre      text not null,
  descripcion text not null default '',
  precio      numeric(10,2) not null check (precio >= 0),
  imagen_url  text,
  activo      boolean not null default true
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
  creado_en               timestamptz not null default now()
);

alter table compras add column if not exists medio_pago       medio_pago;
alter table compras add column if not exists tarjeta_marca    text;
alter table compras add column if not exists tarjeta_ultimos4 text;
alter table compras add column if not exists descuento_canjes numeric(10,2) not null default 0;

do $$ begin
  alter table compras add constraint compras_ultimos4_valido
    check (tarjeta_ultimos4 is null or tarjeta_ultimos4 ~ '^[0-9]{4}$');
exception when duplicate_object then null; end $$;

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
  unique (pelicula_id, usuario_id)
);

create table if not exists canjes (
  id              bigserial primary key,
  usuario_id      uuid not null references auth.users(id) on delete cascade,
  recompensa_id   bigint references recompensas(id) on delete set null,
  nombre          text not null,
  puntos_gastados int not null,
  creado_en       timestamptz not null default now()
);

alter table canjes add column if not exists codigo      text;
alter table canjes add column if not exists tipo        tipo_recompensa;
alter table canjes add column if not exists producto_id bigint references productos(id) on delete set null;
alter table canjes add column if not exists usado       boolean not null default false;
alter table canjes add column if not exists usado_en    timestamptz;
alter table canjes add column if not exists compra_id   bigint references compras(id) on delete set null;

update canjes set codigo = 'CJ' || substr(upper(replace(gen_random_uuid()::text, '-', '')), 1, 8)
 where codigo is null;

update canjes c set tipo = r.tipo, producto_id = r.producto_id
  from recompensas r
 where r.id = c.recompensa_id and c.tipo is null;

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

create index if not exists idx_funciones_pelicula on funciones(pelicula_id);
create index if not exists idx_funciones_inicio   on funciones(inicio);
create index if not exists idx_entradas_funcion   on entradas(funcion_id);
create index if not exists idx_compras_usuario    on compras(usuario_id);
create index if not exists idx_compras_creado     on compras(creado_en);
create index if not exists idx_resenias_pelicula  on resenias(pelicula_id);
create index if not exists idx_reservas_funcion   on reservas(funcion_id);
create index if not exists idx_log_creado         on log_actividad(creado_en desc);
