"""Respuesta de pequena senal posterior al INA, segun las ecuaciones de main.tex."""
from pathlib import Path
import numpy as np
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt

def respuesta(f):
    s = 2j*np.pi*np.asarray(f)
    rp = 1000*337/1337
    h3 = -500/337*(s*rp*20e-9)/((1+s*rp*20e-9)*(1+s*500*4.7e-9))
    h4 = -2000/(500+1/(s*10e-9))
    h5 = 1/(1+s*8200*270e-12)
    return (-10)*h3*h4*h5*(-10000/2200)

if __name__ == '__main__':
    f = np.geomspace(1e3,1e6,30000)
    fig, ax = plt.subplots(figsize=(7.2,4.1),layout='constrained')
    for finite, label, color, style in [(False,'Respuesta ideal posterior al INA','#196b9c','-')]:
        db = 20*np.log10(abs(respuesta(f)))
        ax.semilogx(f/1000,db,label=label,color=color,ls=style,lw=1.8)
        idx = np.flatnonzero(np.diff(np.sign(db-(db.max()-10*np.log10(2)))))
        cuts = [np.interp(db.max()-10*np.log10(2),db[i:i+2] if db[i]<db[i+1] else db[i:i+2][::-1],f[i:i+2] if db[i]<db[i+1] else f[i:i+2][::-1])/1000 for i in idx]
        print(label, 'G(50kHz)=',abs(respuesta(50e3)), 'cortes kHz=',cuts)
        if not finite:
            ax.hlines(db.max()-10*np.log10(2),*cuts,colors=color,linestyles=':',lw=1.3)
            ax.plot(cuts,[db.max()-10*np.log10(2)]*2,'o',color=color,ms=4)
            for cut in cuts:
                ax.annotate(f'{cut:.1f}'.replace('.',',')+' kHz',(cut,db.max()-10*np.log10(2)),xytext=(-12,-20) if cut<50 else (8,-20),textcoords='offset points',ha='right' if cut<50 else 'left',fontsize=9)
    ax.axvline(50,color='0.4',lw=1,ls=':')
    ax.text(54,8,'50 kHz',fontsize=9,color='0.3')
    ax.set(xlabel='Frecuencia (kHz)',ylabel='Magnitud (dB)',xlim=(1,1000),ylim=(-12,50))
    ax.grid(True,which='both',alpha=.18)
    ax.legend(loc='lower center',fontsize=9)
    out=Path(__file__).parent
    fig.savefig(out/'bode_cadena.pdf')
    fig.savefig(out/'bode_cadena.png',dpi=180)
