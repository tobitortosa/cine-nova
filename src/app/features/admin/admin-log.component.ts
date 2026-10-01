import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { LogActividad } from '../../core/models/modelos';
import { NotificacionesService } from '../../core/services/notificaciones.service';
import { ReportesService } from '../../core/services/reportes.service';
import { CargandoComponent } from '../../shared/components/cargando.component';
import { VacioComponent } from '../../shared/components/vacio.component';

type ColorAccion = 'ok' | 'peligro' | 'ambar' | 'neutro';

interface RegistroVista {
  id: number;
  fecha: string;
  hora: string;
  email: string;
  accion: string;
  etiqueta: string;
  entidad: string;
  entidadId: string;
  color: ColorAccion;
}

@Component({
  selector: 'app-admin-log',
  imports: [ReactiveFormsModule, CargandoComponent, VacioComponent],
  templateUrl: './admin-log.component.html',
  styleUrl: './admin-log.component.scss',
})
export class AdminLogComponent implements OnInit {
  private readonly reportes = inject(ReportesService);
  private readonly avisos = inject(NotificacionesService);

  readonly busqueda = new FormControl('', { nonNullable: true });

  readonly registros = signal<LogActividad[]>([]);
  readonly texto = signal('');
  readonly cargando = signal(true);

  readonly vistas = computed<RegistroVista[]>(() => {
    const filtro = this.texto().trim().toLowerCase();
    const lista = this.registros().filter((fila) => {
      if (!filtro) return true;
      const buscable = `${fila.accion} ${fila.entidad} ${fila.email ?? ''}`.toLowerCase();
      return buscable.includes(filtro);
    });

    return lista.map((fila) => ({
      id: fila.id,
      fecha: this.fecha(fila.creado_en),
      hora: this.hora(fila.creado_en),
      email: fila.email ?? 'Sistema',
      accion: fila.accion,
      etiqueta: this.etiquetaAccion(fila.accion),
      entidad: fila.entidad,
      entidadId: fila.entidad_id ?? '',
      color: this.colorAccion(fila.accion),
    }));
  });

  readonly total = computed(() => this.registros().length);
  readonly filtrando = computed(() => this.texto().trim().length > 0);

  constructor() {
    this.busqueda.valueChanges
      .pipe(takeUntilDestroyed())
      .subscribe((valor) => this.texto.set(valor));
  }

  async ngOnInit(): Promise<void> {
    await this.cargar();
  }

  async recargar(): Promise<void> {
    await this.cargar();
  }

  limpiar(): void {
    this.busqueda.setValue('');
  }

  private async cargar(): Promise<void> {
    this.cargando.set(true);

    try {
      this.registros.set(await this.reportes.actividad(200));
    } catch (error) {
      this.avisos.error(
        error instanceof Error ? error.message : 'No se pudo cargar el registro de actividad',
      );
    } finally {
      this.cargando.set(false);
    }
  }

  private fecha(iso: string): string {
    const momento = new Date(iso);
    if (Number.isNaN(momento.getTime())) return '';
    return momento.toLocaleDateString('es-AR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    });
  }

  private hora(iso: string): string {
    const momento = new Date(iso);
    if (Number.isNaN(momento.getTime())) return '';
    return momento.toLocaleTimeString('es-AR', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
  }

  private etiquetaAccion(accion: string): string {
    const nombres: Record<string, string> = {
      crear: 'Creación',
      actualizar: 'Actualización',
      eliminar: 'Eliminación',
      cancelar: 'Cancelación',
      comprar: 'Compra',
      canjear: 'Canje',
      validar_qr: 'Validación QR',
    };
    return nombres[accion] ?? accion.replace(/_/g, ' ');
  }

  private colorAccion(accion: string): ColorAccion {
    if (accion.includes('crear')) return 'ok';
    if (accion.includes('cancelar') || accion.includes('eliminar')) return 'peligro';
    if (accion.includes('validar')) return 'ambar';
    return 'neutro';
  }
}
