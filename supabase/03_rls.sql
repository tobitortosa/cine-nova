alter table perfiles          enable row level security;
alter table generos           enable row level security;
alter table peliculas         enable row level security;
alter table peliculas_generos enable row level security;
alter table salas             enable row level security;
alter table butacas           enable row level security;
alter table funciones         enable row level security;
alter table categorias        enable row level security;
alter table productos         enable row level security;
alter table combos            enable row level security;
alter table cupones           enable row level security;
alter table recompensas       enable row level security;
alter table compras           enable row level security;
alter table entradas          enable row level security;
alter table compra_items      enable row level security;
alter table reservas          enable row level security;
alter table resenias          enable row level security;
alter table canjes            enable row level security;
alter table alertas_estreno   enable row level security;
alter table log_actividad     enable row level security;

drop policy if exists perfiles_select on perfiles;
create policy perfiles_select on perfiles for select
  using (id = auth.uid() or es_admin());

drop policy if exists perfiles_insert on perfiles;
create policy perfiles_insert on perfiles for insert
  with check (id = auth.uid());

drop policy if exists perfiles_update on perfiles;
create policy perfiles_update on perfiles for update
  using (id = auth.uid() or es_admin())
  with check (id = auth.uid() or es_admin());

drop policy if exists perfiles_delete on perfiles;
create policy perfiles_delete on perfiles for delete using (es_admin());

do $$
declare t text;
begin
  foreach t in array array['generos','peliculas','peliculas_generos','salas','butacas',
                           'funciones','categorias','productos','combos','cupones','recompensas']
  loop
    execute format('drop policy if exists %I_select on %I', t, t);
    execute format('create policy %I_select on %I for select using (true)', t, t);
    execute format('drop policy if exists %I_admin on %I', t, t);
    execute format('create policy %I_admin on %I for all using (es_admin()) with check (es_admin())', t, t);
  end loop;
end $$;

drop policy if exists compras_select on compras;
create policy compras_select on compras for select
  using (usuario_id = auth.uid() or es_admin() or es_empleado());

drop policy if exists compras_admin on compras;
create policy compras_admin on compras for all
  using (es_admin()) with check (es_admin());

drop policy if exists entradas_select on entradas;
create policy entradas_select on entradas for select using (true);

drop policy if exists entradas_admin on entradas;
create policy entradas_admin on entradas for all
  using (es_admin()) with check (es_admin());

drop policy if exists compra_items_select on compra_items;
create policy compra_items_select on compra_items for select
  using (exists (select 1 from compras c
                  where c.id = compra_items.compra_id
                    and (c.usuario_id = auth.uid() or es_admin() or es_empleado())));

drop policy if exists compra_items_admin on compra_items;
create policy compra_items_admin on compra_items for all
  using (es_admin()) with check (es_admin());

drop policy if exists reservas_select on reservas;
create policy reservas_select on reservas for select using (true);

drop policy if exists reservas_admin on reservas;
create policy reservas_admin on reservas for all
  using (es_admin()) with check (es_admin());

drop policy if exists resenias_select on resenias;
create policy resenias_select on resenias for select using (true);

drop policy if exists resenias_insert on resenias;
create policy resenias_insert on resenias for insert
  with check (usuario_id = auth.uid());

drop policy if exists resenias_update on resenias;
create policy resenias_update on resenias for update
  using (usuario_id = auth.uid() or es_admin())
  with check (usuario_id = auth.uid() or es_admin());

drop policy if exists resenias_delete on resenias;
create policy resenias_delete on resenias for delete
  using (usuario_id = auth.uid() or es_admin());

drop policy if exists canjes_select on canjes;
create policy canjes_select on canjes for select
  using (usuario_id = auth.uid() or es_admin());

drop policy if exists alertas_select on alertas_estreno;
create policy alertas_select on alertas_estreno for select
  using (usuario_id = auth.uid() or es_admin());

drop policy if exists alertas_insert on alertas_estreno;
create policy alertas_insert on alertas_estreno for insert
  with check (usuario_id = auth.uid());

drop policy if exists alertas_delete on alertas_estreno;
create policy alertas_delete on alertas_estreno for delete
  using (usuario_id = auth.uid() or es_admin());

drop policy if exists log_select on log_actividad;
create policy log_select on log_actividad for select using (es_admin());

do $$ begin
  alter publication supabase_realtime add table entradas;
exception when duplicate_object then null; end $$;

do $$ begin
  alter publication supabase_realtime add table reservas;
exception when duplicate_object then null; end $$;

grant execute on function butacas_estado(bigint, text)                     to anon, authenticated;
grant execute on function reservar_butacas(bigint, bigint[], text)         to anon, authenticated;
grant execute on function peliculas_mas_vendidas(int, int)                 to anon, authenticated;
grant execute on function buscar_compra(text)                              to anon, authenticated;
grant execute on function registrar_compra(bigint, bigint[], jsonb, text, text, numeric, date, text, text[], text, text, text, numeric) to anon, authenticated;
grant execute on function venta_abierta(bigint)                            to anon, authenticated;
grant execute on function preventa_vigente(bigint)                         to anon, authenticated;
grant execute on function cancelar_compra(bigint)                          to authenticated;
grant execute on function canjear_recompensa(bigint)                       to authenticated;
grant execute on function mis_peliculas()                                  to authenticated;
grant execute on function validar_qr(text, text)                           to authenticated;
grant execute on function crear_funcion(bigint, timestamptz, formato_funcion, idioma_funcion, numeric, numeric) to authenticated;
grant execute on function reporte_facturacion(date, date)                  to authenticated;
grant execute on function peliculas_mas_vistas(text)                       to authenticated;
grant execute on function top_productos(int)                               to authenticated;
grant execute on function estadisticas_admin()                             to authenticated;
grant execute on function registrar_log(text, text, text, jsonb)           to authenticated;
