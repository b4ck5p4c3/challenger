import styles from './components.module.css'

export function InputText(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} type={"text"} className={`${props.className} ${styles.inputText}`}/>
}