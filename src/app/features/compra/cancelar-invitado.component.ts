import { Component, computed, inject, input, output, signal } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { AuthService } from '../../core/services/auth.service';
import { ComprasService } from '../../core/services/compras.service';
import { NotificacionesService } from '../../core/services/notificaciones.service';
import { ConfirmarComponent } from '../../shared/components/confirmar.component';
import { SoloDigitosDirective } from '../../shared/directives/solo-digitos.directive';
import { PrecioPipe } from '../../shared/pipes/precio.pipe';
import { ZONA_HORARIA } from '../../shared/utils/ventas';

type Paso = 'inicio' | 'codigo';

@Component({
  selector: 'app-cancelar-invitado',
  imports: [ReactiveFormsModule, RouterLink, ConfirmarComponent, SoloDigitosDirective],
  templateUrl: './cancelar-invitado.component.html',
  styleUrl: './cancelar-invitado.component.scss',
})
export class CancelarInvitadoComponent {
  private readonly auth = inject(AuthService);
  private readonly compras = inject(ComprasService);
  private readonly avisos = inject(NotificacionesService);
  private readonly precio = new PrecioPipe();

  readonly codigo = input.required<string>();
  readonly monto = input.required<number>();
  readonly emailCompra = input<string>('');

  readonly cancelada = output<number>();
  readonly desactualizada = output<void>();

  readonly logueado = this.auth.estaLogueado;
  readonly emailCuenta = computed(() => this.auth.perfil()?.email ?? '');

  readonly paso = signal<Paso>('inicio');
  readonly enviando = signal(false);
  readonly procesando = signal(false);
  readonly confirmando = signal(false);
  readonly destino = signal('');
  readonly vence = signal('');

  readonly formulario = new FormGroup({
    clave: new FormControl('', {
      nonNullable: true,
      validators: [Validators.required, Validators.pattern(/^\d{6}$/)],
    }),
  });

  readonly clave = this.formulario.controls.clave;

  readonly volverA = computed(() => ({ volverA: `/compra/${this.codigo()}#cancelar` }));

  readonly textoConfirmacion = computed(() => {
    const cuenta = this.emailCuenta();
    const destino = cuenta ? `la cuenta ${cuenta}` : 'tu cuenta';
    return `Las entradas dejan de valer y el QR ya no sirve para entrar ni para retirar el candy bar. Te acreditamos ${this.precio.transform(this.monto())} como crédito en ${destino}. No se puede deshacer.`;
  });

  mostrarErrorClave(): boolean {
    return this.clave.touched && this.clave.invalid;
  }

  usarCodigoRecibido(): void {
    this.destino.set(this.emailCompra());
    this.vence.set('');
    this.clave.reset();
    this.paso.set('codigo');
  }

  async pedirCodigo(): Promise<void> {
    if (this.enviando()) return;
    this.enviando.set(true);

    try {
      const respuesta = await this.compras.pedirCodigoCancelacion(this.codigo());

      if (respuesta.ok) {
        this.destino.set(respuesta.email);
        this.vence.set(this.horaDe(respuesta.vence));
        this.clave.reset();
        this.paso.set('codigo');
        this.avisos.exito(`Te mandamos el código a ${respuesta.email}`);
        return;
      }

      this.avisos.error(respuesta.motivo);

      if (respuesta.espera) {
        if (this.paso() !== 'codigo') this.usarCodigoRecibido();
        return;
      }

      this.desactualizada.emit();
    } catch (e) {
      this.avisos.error(e instanceof Error ? e.message : 'No pudimos enviar el código');
      this.desactualizada.emit();
    } finally {
      this.enviando.set(false);
    }
  }

  pedirConfirmacion(): void {
    if (this.procesando()) return;

    if (this.clave.invalid) {
      this.clave.markAsTouched();
      return;
    }

    this.confirmando.set(true);
  }

  async confirmar(): Promise<void> {
    if (this.procesando()) return;
    this.procesando.set(true);

    try {
      const respuesta = await this.compras.cancelarComoInvitado(this.codigo(), this.clave.value.trim());

      if (respuesta.ok) {
        this.avisos.exito('Cancelamos la compra y te acreditamos el importe como crédito');
        await this.auth.refrescarPerfil().catch(() => undefined);
        this.cancelada.emit(Number(respuesta.credito));
        return;
      }

      this.avisos.error(respuesta.motivo);

      if (respuesta.vencido) {
        this.clave.reset();
        this.paso.set('inicio');
      } else if (respuesta.restantes === undefined) {
        this.desactualizada.emit();
      }
    } catch (e) {
      this.avisos.error(e instanceof Error ? e.message : 'No se pudo cancelar la compra');
      this.desactualizada.emit();
    } finally {
      this.procesando.set(false);
    }
  }

  private horaDe(momento: string): string {
    const fecha = new Date(momento);
    if (Number.isNaN(fecha.getTime())) return '';
    return fecha.toLocaleTimeString('es-AR', {
      timeZone: ZONA_HORARIA,
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    });
  }
}
