import { Injectable, inject } from '@angular/core';
import { SupabaseService } from './supabase.service';
import { ButacasService } from './butacas.service';
import {
  Compra,
  ItemCarrito,
  MiPelicula,
  ResultadoValidacion,
  ResumenCompra,
} from '../models/modelos';

@Injectable({ providedIn: 'root' })
export class ComprasService {
  private readonly supabase = inject(SupabaseService);
  private readonly butacas = inject(ButacasService);

  async registrar(datos: {
    funcionId: number;
    butacas: number[];
    items: ItemCarrito[];
    email: string;
    cupon?: string | null;
    usarCredito?: number;
    fechaNacimiento?: string | null;
  }): Promise<Compra> {
    const { data, error } = await this.supabase.client.rpc('registrar_compra', {
      p_funcion_id: datos.funcionId,
      p_butacas: datos.butacas,
      p_items: datos.items.map((item) => ({
        producto_id: item.producto_id,
        combo_id: item.combo_id,
        nombre: item.nombre,
        cantidad: item.cantidad,
        precio_unitario: item.precio_unitario,
      })),
      p_email: datos.email,
      p_cupon_codigo: datos.cupon ?? null,
      p_usar_credito: datos.usarCredito ?? 0,
      p_fecha_nacimiento: datos.fechaNacimiento ?? null,
      p_sesion: this.butacas.sesion,
    });

    if (error) {
      throw new Error(error.message || 'No se pudo registrar la compra');
    }

    const compra = Array.isArray(data) ? data[0] : data;

    if (!compra) {
      throw new Error('No se pudo registrar la compra');
    }

    return compra as Compra;
  }

  async buscarPorCodigo(codigo: string): Promise<ResumenCompra | null> {
    const { data, error } = await this.supabase.client.rpc('buscar_compra', {
      p_codigo: codigo,
    });

    if (error) {
      throw new Error(error.message || 'No se pudo buscar la compra');
    }

    if (!data) {
      return null;
    }

    return data as ResumenCompra;
  }

  async misCompras(): Promise<Compra[]> {
    const { data: datosUsuario } = await this.supabase.client.auth.getUser();
    const usuario = datosUsuario.user;

    if (!usuario) {
      throw new Error('Necesitás iniciar sesión para ver tus compras');
    }

    const { data, error } = await this.supabase.client
      .from('compras')
      .select('*, funcion:funciones(*, pelicula:peliculas(*))')
      .eq('usuario_id', usuario.id)
      .order('creado_en', { ascending: false });

    if (error) {
      throw new Error('No se pudieron cargar tus compras');
    }

    return (data ?? []) as Compra[];
  }

  async cancelar(compraId: number): Promise<void> {
    const { error } = await this.supabase.client.rpc('cancelar_compra', {
      p_compra_id: compraId,
    });

    if (error) {
      throw new Error(error.message || 'No se pudo cancelar la compra');
    }
  }

  async misPeliculas(): Promise<MiPelicula[]> {
    const { data, error } = await this.supabase.client.rpc('mis_peliculas');

    if (error) {
      throw new Error(error.message || 'No se pudieron cargar tus películas');
    }

    return (data ?? []) as MiPelicula[];
  }

  async validarQr(codigo: string, tipo: 'entrada' | 'candy'): Promise<ResultadoValidacion> {
    const { data, error } = await this.supabase.client.rpc('validar_qr', {
      p_codigo: codigo,
      p_tipo: tipo,
    });

    if (error) {
      throw new Error(error.message || 'No se pudo validar el código');
    }

    if (!data) {
      return { ok: false, motivo: 'Código inválido' };
    }

    return data as ResultadoValidacion;
  }
}
