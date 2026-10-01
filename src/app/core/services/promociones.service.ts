import { Injectable, inject } from '@angular/core';
import { SupabaseService } from './supabase.service';
import { Canje, Cupon, Recompensa } from '../models/modelos';

@Injectable({ providedIn: 'root' })
export class PromocionesService {
  private readonly sb = inject(SupabaseService);

  async cupones(): Promise<Cupon[]> {
    const { data, error } = await this.sb.client
      .from('cupones')
      .select('*')
      .order('codigo', { ascending: true });

    if (error) throw new Error('No se pudieron cargar los cupones');
    return (data ?? []) as Cupon[];
  }

  async crearCupon(datos: Partial<Cupon>): Promise<Cupon> {
    const { data, error } = await this.sb.client
      .from('cupones')
      .insert(this.limpiarCupon(datos))
      .select('*')
      .single();

    if (error) throw new Error('No se pudo crear el cupón. Revisá que el código no esté repetido');
    return data as Cupon;
  }

  async actualizarCupon(id: number, datos: Partial<Cupon>): Promise<void> {
    const { error } = await this.sb.client
      .from('cupones')
      .update(this.limpiarCupon(datos))
      .eq('id', id);

    if (error) throw new Error('No se pudo actualizar el cupón');
  }

  async eliminarCupon(id: number): Promise<void> {
    const { error } = await this.sb.client.from('cupones').delete().eq('id', id);
    if (error) throw new Error('No se pudo eliminar el cupón porque ya fue usado en una compra');
  }

  async recompensas(soloActivas = false): Promise<Recompensa[]> {
    let consulta = this.sb.client.from('recompensas').select('*');
    if (soloActivas) consulta = consulta.eq('activo', true);

    const { data, error } = await consulta.order('costo_puntos', { ascending: true });

    if (error) throw new Error('No se pudieron cargar las recompensas');
    return (data ?? []) as Recompensa[];
  }

  async crearRecompensa(datos: Partial<Recompensa>): Promise<Recompensa> {
    const { data, error } = await this.sb.client
      .from('recompensas')
      .insert(this.limpiarRecompensa(datos))
      .select('*')
      .single();

    if (error) throw new Error('No se pudo crear la recompensa');
    return data as Recompensa;
  }

  async actualizarRecompensa(id: number, datos: Partial<Recompensa>): Promise<void> {
    const { error } = await this.sb.client
      .from('recompensas')
      .update(this.limpiarRecompensa(datos))
      .eq('id', id);

    if (error) throw new Error('No se pudo actualizar la recompensa');
  }

  async eliminarRecompensa(id: number): Promise<void> {
    const { error } = await this.sb.client.from('recompensas').delete().eq('id', id);
    if (error) throw new Error('No se pudo eliminar la recompensa porque ya fue canjeada');
  }

  async canjear(recompensaId: number): Promise<Canje> {
    const { data, error } = await this.sb.client.rpc('canjear_recompensa', {
      p_recompensa_id: recompensaId,
    });

    if (error) throw new Error(error.message || 'No se pudo canjear la recompensa');

    const fila = Array.isArray(data) ? data[0] : data;
    if (!fila) throw new Error('No se pudo canjear la recompensa');

    return fila as Canje;
  }

  async misCanjes(): Promise<Canje[]> {
    const usuario = await this.usuarioActual();
    if (!usuario) return [];

    const { data, error } = await this.sb.client
      .from('canjes')
      .select('*')
      .eq('usuario_id', usuario)
      .order('creado_en', { ascending: false });

    if (error) throw new Error('No se pudieron cargar tus canjes');
    return (data ?? []) as Canje[];
  }

  async canjesDisponibles(): Promise<Canje[]> {
    const usuario = await this.usuarioActual();
    if (!usuario) return [];

    const { data, error } = await this.sb.client
      .from('canjes')
      .select('*')
      .eq('usuario_id', usuario)
      .eq('usado', false)
      .order('creado_en', { ascending: true });

    if (error) throw new Error('No se pudieron cargar tus canjes disponibles');
    return (data ?? []) as Canje[];
  }

  private async usuarioActual(): Promise<string | null> {
    const { data } = await this.sb.client.auth.getSession();
    return data.session?.user.id ?? null;
  }

  private limpiarCupon(datos: Partial<Cupon>): Record<string, unknown> {
    const fila: Record<string, unknown> = {};

    if (datos.codigo !== undefined) fila['codigo'] = datos.codigo.trim().toUpperCase();
    if (datos.descripcion !== undefined) fila['descripcion'] = datos.descripcion.trim();
    if (datos.porcentaje !== undefined) fila['porcentaje'] = Number(datos.porcentaje);
    if (datos.tipo !== undefined) fila['tipo'] = datos.tipo;
    if (datos.edad_minima !== undefined) {
      fila['edad_minima'] = datos.edad_minima === null ? null : Number(datos.edad_minima);
    }
    if (datos.activo !== undefined) fila['activo'] = datos.activo;

    return fila;
  }

  private limpiarRecompensa(datos: Partial<Recompensa>): Record<string, unknown> {
    const fila: Record<string, unknown> = {};

    if (datos.nombre !== undefined) fila['nombre'] = datos.nombre.trim();
    if (datos.tipo !== undefined) fila['tipo'] = datos.tipo;
    if (datos.producto_id !== undefined) {
      fila['producto_id'] = datos.producto_id === null ? null : Number(datos.producto_id);
    }
    if (datos.costo_puntos !== undefined) fila['costo_puntos'] = Number(datos.costo_puntos);
    if (datos.activo !== undefined) fila['activo'] = datos.activo;

    return fila;
  }
}
