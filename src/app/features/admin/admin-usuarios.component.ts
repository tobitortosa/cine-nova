import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { ReportesService } from '../../core/services/reportes.service';
import { AuthService } from '../../core/services/auth.service';
import { NotificacionesService } from '../../core/services/notificaciones.service';
import { Perfil, RolUsuario } from '../../core/models/modelos';
import { PrecioPipe } from '../../shared/pipes/precio.pipe';
import { CargandoComponent } from '../../shared/components/cargando.component';
import { VacioComponent } from '../../shared/components/vacio.component';

type FiltroRol = 'todos' | RolUsuario;

@Component({
  selector: 'app-admin-usuarios',
  imports: [PrecioPipe, CargandoComponent, VacioComponent],
  templateUrl: './admin-usuarios.component.html',
  styleUrl: './admin-usuarios.component.scss',
})
export class AdminUsuariosComponent implements OnInit {
  private readonly reportes = inject(ReportesService);
  private readonly auth = inject(AuthService);
  private readonly avisos = inject(NotificacionesService);

  readonly usuarios = signal<Perfil[]>([]);
  readonly cargando = signal(true);
  readonly busqueda = signal('');
  readonly filtroRol = signal<FiltroRol>('todos');
  readonly cambiandoId = signal<string | null>(null);

  readonly roles: RolUsuario[] = ['cliente', 'empleado', 'admin'];

  private readonly formatoNumero = new Intl.NumberFormat('es-AR');

  readonly totales = computed(() => {
    const lista = this.usuarios();

    return {
      total: lista.length,
      clientes: lista.filter((usuario) => usuario.rol === 'cliente').length,
      empleados: lista.filter((usuario) => usuario.rol === 'empleado').length,
      administradores: lista.filter((usuario) => usuario.rol === 'admin').length,
    };
  });

  readonly filtrados = computed(() => {
    const texto = this.normalizar(this.busqueda());
    const rol = this.filtroRol();

    return this.usuarios().filter((usuario) => {
      if (rol !== 'todos' && usuario.rol !== rol) return false;
      if (!texto) return true;

      const nombre = this.normalizar(`${usuario.nombre ?? ''} ${usuario.apellido ?? ''}`);
      const email = this.normalizar(usuario.email ?? '');

      return nombre.includes(texto) || email.includes(texto);
    });
  });

  async ngOnInit(): Promise<void> {
    await this.cargar();
  }

  cambiarBusqueda(evento: Event): void {
    this.busqueda.set((evento.target as HTMLInputElement).value);
  }

  limpiarBusqueda(): void {
    this.busqueda.set('');
  }

  cambiarFiltroRol(valor: FiltroRol): void {
    this.filtroRol.set(valor);
  }

  esUnoMismo(usuario: Perfil): boolean {
    return usuario.id === this.auth.perfil()?.id;
  }

  nombreCompleto(usuario: Perfil): string {
    const completo = `${usuario.nombre ?? ''} ${usuario.apellido ?? ''}`.trim();
    return completo || 'Sin nombre';
  }

  iniciales(usuario: Perfil): string {
    const nombre = (usuario.nombre ?? '').trim();
    const apellido = (usuario.apellido ?? '').trim();
    const letras = `${nombre.charAt(0)}${apellido.charAt(0)}`.trim();
    return (letras || (usuario.email ?? '?').charAt(0)).toUpperCase();
  }

  etiquetaRol(rol: RolUsuario): string {
    switch (rol) {
      case 'admin':
        return 'Administrador';
      case 'empleado':
        return 'Empleado';
      default:
        return 'Cliente';
    }
  }

  fecha(valor: string | null): string {
    if (!valor) return '—';

    const partes = valor.slice(0, 10).split('-');
    if (partes.length !== 3) return '—';

    return `${partes[2]}/${partes[1]}/${partes[0]}`;
  }

  fechaAlta(valor: string | null): string {
    if (!valor) return '—';

    const momento = new Date(valor);
    if (Number.isNaN(momento.getTime())) return '—';

    return momento.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' });
  }

  edad(valor: string | null): string {
    if (!valor) return '—';

    const [anio, mes, dia] = valor.slice(0, 10).split('-').map(Number);
    const nacimiento = new Date(anio, mes - 1, dia);
    if (Number.isNaN(nacimiento.getTime())) return '—';

    const hoy = new Date();
    let anios = hoy.getFullYear() - nacimiento.getFullYear();
    const meses = hoy.getMonth() - nacimiento.getMonth();

    if (meses < 0 || (meses === 0 && hoy.getDate() < nacimiento.getDate())) {
      anios -= 1;
    }

    if (anios < 0 || anios > 130) return '—';

    return `${anios} años`;
  }

  numero(valor: number): string {
    return this.formatoNumero.format(valor);
  }

  async cambiarRol(usuario: Perfil, evento: Event): Promise<void> {
    const seleccionado = (evento.target as HTMLSelectElement).value as RolUsuario;
    if (seleccionado === usuario.rol) return;

    if (this.esUnoMismo(usuario)) {
      this.avisos.error('No podés cambiar tu propio rol.');
      await this.cargar();
      return;
    }

    this.cambiandoId.set(usuario.id);

    try {
      await this.reportes.cambiarRol(usuario.id, seleccionado);
      this.avisos.exito(
        `${this.nombreCompleto(usuario)} ahora es ${this.etiquetaRol(seleccionado).toLowerCase()}.`,
      );
      await this.cargar();
    } catch (e) {
      this.avisos.error(e instanceof Error ? e.message : 'Ocurrió un error');
      await this.cargar();
    } finally {
      this.cambiandoId.set(null);
    }
  }

  private async cargar(): Promise<void> {
    try {
      this.usuarios.set(await this.reportes.usuarios());
    } catch (e) {
      this.avisos.error(e instanceof Error ? e.message : 'Ocurrió un error');
    } finally {
      this.cargando.set(false);
    }
  }

  private normalizar(texto: string): string {
    return (texto ?? '')
      .trim()
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '');
  }
}
