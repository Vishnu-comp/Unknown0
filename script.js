const io=new IntersectionObserver(es=>es.forEach(e=>{if(e.isIntersecting){e.target.classList.add('in');io.unobserve(e.target)}}),{threshold:.12});
document.querySelectorAll('.reveal').forEach(el=>io.observe(el));
const lb=document.getElementById('lb'),lbi=lb.querySelector('img');
document.querySelectorAll('figure img').forEach(i=>i.addEventListener('click',()=>{lbi.src=i.src;lbi.alt=i.alt;lb.hidden=false}));
lb.addEventListener('click',()=>lb.hidden=true);
addEventListener('keydown',e=>{if(e.key==='Escape')lb.hidden=true});
