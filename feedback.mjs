import {randomUUID} from 'node:crypto';

export function createFeedback(db,ApiError){
  db.exec(`CREATE TABLE IF NOT EXISTS feedback(id TEXT PRIMARY KEY,userId TEXT NOT NULL REFERENCES users(id),content TEXT NOT NULL,createdAt TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS feedback_created ON feedback(createdAt DESC,id DESC);
CREATE INDEX IF NOT EXISTS feedback_user_created ON feedback(userId,createdAt DESC,id DESC);`);
  function list(user,params){
    const limitText=params.get('limit')??'50',offsetText=params.get('offset')??'0',limit=Number(limitText),offset=Number(offsetText);
    if(!/^\d+$/.test(limitText)||!Number.isSafeInteger(limit)||limit<1||limit>50||!/^\d+$/.test(offsetText)||!Number.isSafeInteger(offset))throw new ApiError(400,'留言分页参数无效');
    const messages=user.role==='admin'
      ?db.prepare('SELECT f.id,f.content,f.createdAt,u.email FROM feedback f JOIN users u ON u.id=f.userId ORDER BY f.createdAt DESC,f.id DESC LIMIT ? OFFSET ?').all(limit+1,offset)
      :db.prepare('SELECT id,content,createdAt FROM feedback WHERE userId=? ORDER BY createdAt DESC,id DESC LIMIT ? OFFSET ?').all(user.id,limit+1,offset);
    return {messages:messages.slice(0,limit),hasMore:messages.length>limit};
  }
  function add(user,content){
    if(typeof content!=='string')throw new ApiError(400,'留言须为 1–1000 个字符');content=content.trim();
    if(!content||content.length>1000)throw new ApiError(400,'留言须为 1–1000 个字符');
    db.exec('BEGIN IMMEDIATE');
    try{
      if(db.prepare('SELECT role FROM users WHERE id=?').get(user.id)?.role!=='user')throw new ApiError(403,'仅普通账号可以留言');
      const now=Date.now(),latest=db.prepare('SELECT createdAt FROM feedback WHERE userId=? ORDER BY createdAt DESC,id DESC LIMIT 1').get(user.id),remaining=latest?60000-(now-Date.parse(latest.createdAt)):0;
      if(remaining>0)throw new ApiError(429,`留言过于频繁，请 ${Math.ceil(remaining/1000)} 秒后再试`);
      const message={id:randomUUID(),content,createdAt:new Date(now).toISOString()};
      db.prepare('INSERT INTO feedback(id,userId,content,createdAt) VALUES(?,?,?,?)').run(message.id,user.id,message.content,message.createdAt);db.exec('COMMIT');return message;
    }catch(error){db.exec('ROLLBACK');throw error;}
  }
  return {list,add};
}
